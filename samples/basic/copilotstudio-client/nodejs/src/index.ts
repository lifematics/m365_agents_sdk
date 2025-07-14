/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as msal from '@azure/msal-node'
import { Activity, ActivityTypes, CardAction } from '@microsoft/agents-activity'
import { ConnectionSettings, loadCopilotStudioConnectionSettingsFromEnv, CopilotStudioClient } from '@microsoft/agents-copilotstudio-client'
import pkg from '@microsoft/agents-copilotstudio-client/package.json' with { type: 'json' }
import open from 'open'
import os from 'os'
import path from 'path'
import fs from 'fs'
import csv from 'csv-parser'
import * as createCsvWriter from 'csv-writer'
import * as XLSX from 'xlsx'

import { MsalCachePlugin } from './msalCachePlugin.js'

interface QuestionRow {
  question: string
  answer?: string
  citations?: string
  citationTexts?: string
  searchTerms?: string
  [key: string]: any
}

async function acquireToken (settings: ConnectionSettings): Promise<string> {
  const msalConfig = {
    auth: {
      clientId: settings.appClientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
    },
    cache: {
      cachePlugin: new MsalCachePlugin(path.join(os.tmpdir(), 'mcssample.tockencache.json'))
    },
    system: {
      loggerOptions: {
        loggerCallback (loglevel: msal.LogLevel, message: string, containsPii: boolean) {
          if (!containsPii) {
            console.log(loglevel, message)
          }
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Verbose,
      }
    }
  }
  const pca = new msal.PublicClientApplication(msalConfig)
  const tokenRequest = {
    scopes: ['https://api.powerplatform.com/.default'],
    redirectUri: 'http://localhost',
    openBrowser: async (url: string) => {
      await open(url)
    }
  }
  let token
  try {
    const accounts = await pca.getAllAccounts()
    if (accounts.length > 0) {
      const response2 = await pca.acquireTokenSilent({ account: accounts[0], scopes: tokenRequest.scopes })
      token = response2.accessToken
    } else {
      const response = await pca.acquireTokenInteractive(tokenRequest)
      token = response.accessToken
    }
  } catch (error) {
    console.error('Error acquiring token interactively:', error)
    const response = await pca.acquireTokenInteractive(tokenRequest)
    token = response.accessToken
  }
  return token
}

const createClient = async (): Promise<CopilotStudioClient> => {
  const settings = loadCopilotStudioConnectionSettingsFromEnv()
  const token = await acquireToken(settings)
  const copilotClient = new CopilotStudioClient(settings, token)
  console.log(`Copilot Studio Client Version: ${pkg.version}, running with settings: ${JSON.stringify(settings, null, 2)}`)
  return copilotClient
}

const processCSVQuestions = async (csvFilePath: string, outputCsvPath: string, outputAsCsv: boolean = false): Promise<void> => {
  console.log(`Processing CSV file: ${csvFilePath}`)
  
  const copilotClient = await createClient()
  const results: QuestionRow[] = []
  
  return new Promise((resolve, reject) => {
    const questions: QuestionRow[] = []
    
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row: QuestionRow) => {
        if (row.question && row.question.trim()) {
          questions.push(row)
        }
      })
      .on('end', async () => {
        try {
          console.log(`Found ${questions.length} questions to process`)
          
          for (let i = 0; i < questions.length; i++) {
            const question = questions[i]
            console.log(`\nProcessing question ${i + 1}/${questions.length}: ${question.question}`)
            
            // Start a new conversation for each question
            const startActivity: Activity = await copilotClient.startConversationAsync(true)
            const conversationId = startActivity.conversation?.id!
            
            try {
              const replies = await copilotClient.askQuestionAsync(question.question, conversationId)
              
              // Extract the answer from the replies
              console.log(JSON.stringify(replies, null, 2));
              let answer = ''
              let citations: any[] = []
              let searchTerms: any[] = []
              
              replies.forEach((act: Activity) => {
                if (act.type === ActivityTypes.Message && act.text) {
                  answer += act.text + ' '
                  
                  // Extract citations and search terms from channelData
                  if (act.channelData && act.channelData['pva:gpt-feedback']) {
                    const gptFeedback = act.channelData['pva:gpt-feedback']
                    
                    // Extract textCitations
                    if (gptFeedback.summarizationOpenAIResponse?.result?.textCitations) {
                      citations = gptFeedback.summarizationOpenAIResponse.result.textCitations
                    }
                    
                    // Extract searchTerms
                    if (gptFeedback.searchTerms) {
                      searchTerms = gptFeedback.searchTerms
                    }
                  }
                }
              })
              
              question.answer = answer.trim()
              
              // Format citations for output
              if (citations.length > 0) {
                const citationSummary = citations.map(citation => {
                  return `Title: ${citation.title || 'N/A'}\nURL: ${citation.url || 'N/A'}\nText: ${(citation.text || '').substring(0, 200)}...`
                }).join('\n\n---\n\n')
                question.citations = citationSummary
                
                // Store full citation texts in separate column
                const citationFullTexts = citations.map(citation => {
                  return citation.text || 'N/A'
                }).join('\n\n---\n\n')
                question.citationTexts = citationFullTexts
              }
              
              // Format search terms for output
              if (searchTerms.length > 0) {
                const searchTermsSummary = searchTerms.map(term => {
                  return `Source: ${term.source || 'N/A'}, Term: ${term.term || 'N/A'}`
                }).join('\n')
                question.searchTerms = searchTermsSummary
              }
              
              console.log(`Answer: ${question.answer}`)
              if (question.citations) {
                console.log(`Citations found: ${citations.length} items`)
              }
              if (question.searchTerms) {
                console.log(`Search terms: ${question.searchTerms}`)
              }
              
            } catch (error) {
              console.error(`Error processing question "${question.question}":`, error)
              question.answer = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
            
            results.push(question)
            
            // Add a small delay between requests to avoid overwhelming the service
            if (i < questions.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          }
          
          // Write results to output file based on format choice
          if (outputAsCsv) {
            await writeResultsToCSV(results, outputCsvPath)
            console.log(`\nResults written to CSV: ${outputCsvPath}`)
          } else {
            await writeResultsToExcel(results, outputCsvPath)
            console.log(`\nResults written to Excel: ${outputCsvPath}`)
          }
          resolve()
          
        } catch (error) {
          reject(error)
        }
      })
      .on('error', (error) => {
        reject(error)
      })
  })
}

const writeResultsToExcel = async (results: QuestionRow[], outputPath: string): Promise<void> => {
  if (results.length === 0) {
    throw new Error('No results to write')
  }
  
  // Get all unique column names from the results
  const allColumns = new Set<string>()
  results.forEach(row => {
    Object.keys(row).forEach(key => allColumns.add(key))
  })
  
  // Ensure 'question', 'answer', 'citations', 'citationTexts', and 'searchTerms' columns are included
  allColumns.add('question')
  allColumns.add('answer')
  allColumns.add('citations')
  allColumns.add('citationTexts')
  allColumns.add('searchTerms')
  
  const columnNames = Array.from(allColumns)
  
  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new()
  const worksheet: XLSX.WorkSheet = {}
  
  // Set column widths - make citation columns wider
  const columnWidths = columnNames.map(col => {
    if (col === 'citations' || col === 'citationTexts' || col === 'searchTerms') {
      return { wch: 50 } // Wide columns for citation data
    } else if (col === 'question' || col === 'answer') {
      return { wch: 30 } // Medium width for questions and answers
    } else {
      return { wch: 15 } // Default width for other columns
    }
  })
  worksheet['!cols'] = columnWidths
  
  // Add header row
  columnNames.forEach((colName, colIndex) => {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: colIndex })
    worksheet[cellAddress] = {
      v: colName,
      t: 's',
      s: {
        font: { bold: true },
        alignment: {
          wrapText: true,
          vertical: 'top',
          horizontal: 'center'
        }
      }
    }
  })
  
  // Add data rows
  results.forEach((row, rowIndex) => {
    const actualRowIndex = rowIndex + 1 // +1 because header is at row 0
    columnNames.forEach((colName, colIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ r: actualRowIndex, c: colIndex })
      const cellValue = row[colName] || ''
      
      worksheet[cellAddress] = {
        v: cellValue,
        t: 's', // String type
        s: {
          alignment: {
            wrapText: true,
            vertical: 'top'
          }
        }
      }
    })
  })
  
  // Set row heights - make rows taller to accommodate long text
  const rowHeights = []
  rowHeights[0] = { hpt: 25 } // Header row height
  for (let i = 1; i <= results.length; i++) {
    rowHeights[i] = { hpt: 120 } // Data row height - taller for multi-line content
  }
  worksheet['!rows'] = rowHeights
  
  // Set the range for the worksheet
  const range = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: columnNames.length - 1, r: results.length }
  })
  worksheet['!ref'] = range
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results')
  
  // Write to file
  XLSX.writeFile(workbook, outputPath)
}

const writeResultsToCSV = async (results: QuestionRow[], outputPath: string): Promise<void> => {
  if (results.length === 0) {
    throw new Error('No results to write')
  }
  
  // Get all unique column names from the results
  const allColumns = new Set<string>()
  results.forEach(row => {
    Object.keys(row).forEach(key => allColumns.add(key))
  })
  
  // Ensure 'question', 'answer', 'citations', 'citationTexts', and 'searchTerms' columns are included
  allColumns.add('question')
  allColumns.add('answer')
  allColumns.add('citations')
  allColumns.add('citationTexts')
  allColumns.add('searchTerms')
  
  const columnNames = Array.from(allColumns)
  // Write UTF-8 BOM to the file before writing CSV content
  fs.writeFileSync(outputPath, '\uFEFF', { encoding: 'utf8' })
  // Write header row after BOM
  fs.appendFileSync(outputPath, columnNames.join(',') + '\n', { encoding: 'utf8' })

  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: outputPath,
    header: columnNames.map(name => ({ id: name, title: name })),
    append: true // Append after BOM and header
  })

  await csvWriter.writeRecords(results)
}

const showUsage = () => {
  console.log(`
Usage:
  npm start <input.csv> [output.xlsx]
  npm start <input.csv> --output-in-csv [output.csv]

CSV Format:
  The input CSV file should have a 'question' column containing the questions to ask.
  The output Excel file will include all original columns plus an 'answer' column with responses.
  Long text columns (citations, citationTexts, searchTerms) will have wider columns and taller rows.
  Use --output-in-csv flag to output results as CSV instead of Excel.

Examples:
  npm start questions.csv
  npm start questions.csv answers.xlsx
  npm start questions.csv --output-in-csv
  npm start questions.csv --output-in-csv answers.csv
`)
}

const main = async () => {
  const args = process.argv.slice(2)
  
  if (args.includes('--help') || args.includes('-h')) {
    showUsage()
    return
  }
  
  if (args.length >= 1) {
    const inputCsvPath = args[0]
    const outputAsCsv = args.includes('--output-in-csv')
    
    // Determine output file path
    let outputCsvPath: string
    if (outputAsCsv) {
      // Find custom output path if provided after --output-in-csv
      const csvFlagIndex = args.indexOf('--output-in-csv')
      if (csvFlagIndex + 1 < args.length && !args[csvFlagIndex + 1].startsWith('--')) {
        outputCsvPath = args[csvFlagIndex + 1]
      } else {
        outputCsvPath = inputCsvPath.replace('.csv', '_with_answers.csv')
      }
    } else {
      // Excel output (default)
      outputCsvPath = args[1] || inputCsvPath.replace('.csv', '_with_answers.xlsx')
    }
    
    if (!fs.existsSync(inputCsvPath)) {
      console.error(`Error: CSV file not found: ${inputCsvPath}`)
      showUsage()
      process.exit(1)
    }
    
    try {
      await processCSVQuestions(inputCsvPath, outputCsvPath, outputAsCsv)
      if (outputAsCsv) {
        console.log('\nCSV file processing completed successfully!')
      } else {
        console.log('\nExcel file processing completed successfully!')
      }
    } catch (error) {
      console.error('Error processing file:', error)
      process.exit(1)
    }
  } else {
    console.error('Error: CSV file path is required.')
    showUsage()
    process.exit(1)
  }
}

main().catch(e => console.log(e))
