/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as msal from '@azure/msal-node'
import { Activity, ActivityTypes, CardAction } from '@microsoft/agents-activity'
import { ConnectionSettings, loadCopilotStudioConnectionSettingsFromEnv, CopilotStudioClient } from '@microsoft/agents-copilotstudio-client'
import pkg from '@microsoft/agents-copilotstudio-client/package.json' with { type: 'json' }
import readline from 'readline'
import open from 'open'
import os from 'os'
import path from 'path'
import fs from 'fs'
import csv from 'csv-parser'
import * as createCsvWriter from 'csv-writer'

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const askQuestion = async (copilotClient: CopilotStudioClient, conversationId: string) => {
  rl.question('\n>>>: ', async (answer) => {
    if (answer.toLowerCase() === 'exit') {
      rl.close()
      return
    } else if (answer.length > 0){
      const replies = await copilotClient.askQuestionAsync(answer, conversationId)
      replies.forEach((act: Activity) => {
        if (act.type === ActivityTypes.Message) {
          console.log(`\n${act.text}`)
          act.suggestedActions?.actions.forEach((action: CardAction) => console.log(action.value))
        } else if (act.type === ActivityTypes.EndOfConversation) {
          console.log(`\n${act.text}`)
          rl.close()
        }
      })
    }
    await askQuestion(copilotClient, conversationId)
  })
}

const processCSVQuestions = async (csvFilePath: string, outputCsvPath: string): Promise<void> => {
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
              
              // Format citations for CSV
              if (citations.length > 0) {
                const citationSummary = citations.map(citation => {
                  return `Title: ${citation.title || 'N/A'}\nURL: ${citation.url || 'N/A'}\nText: ${(citation.text || '').substring(0, 200)}...`
                }).join('\n\n---\n\n')
                question.citations = citationSummary
                
                // Store full citation texts in separate column
                const citationFullTexts = citations.map(citation => {
                  return `Title: ${citation.title || 'N/A'}\nURL: ${citation.url || 'N/A'}\nFull Text: ${citation.text || 'N/A'}`
                }).join('\n\n---\n\n')
                question.citationTexts = citationFullTexts
              }
              
              // Format search terms for CSV
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
          
          // Write results to output CSV
          await writeResultsToCSV(results, outputCsvPath)
          console.log(`\nResults written to: ${outputCsvPath}`)
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
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: outputPath,
    header: columnNames.map(name => ({ id: name, title: name }))
  })
  
  await csvWriter.writeRecords(results)
}

const showUsage = () => {
  console.log(`
Usage:
  Interactive mode: npm start
  CSV batch mode:   npm start -- --csv <input.csv> [output.csv]

CSV Format:
  The input CSV file should have a 'question' column containing the questions to ask.
  The output CSV will include all original columns plus an 'answer' column with responses.

Examples:
  npm start -- --csv questions.csv
  npm start -- --csv questions.csv answers.csv
`)
}

const main = async () => {
  const args = process.argv.slice(2)
  
  if (args.includes('--help') || args.includes('-h')) {
    showUsage()
    return
  }
  
  if (args.length >= 2 && args[0] === '--csv') {
    // CSV mode
    const inputCsvPath = args[1]
    const outputCsvPath = args[2] || inputCsvPath.replace('.csv', '_with_answers.csv')
    
    if (!fs.existsSync(inputCsvPath)) {
      console.error(`Error: CSV file not found: ${inputCsvPath}`)
      showUsage()
      process.exit(1)
    }
    
    try {
      await processCSVQuestions(inputCsvPath, outputCsvPath)
      console.log('\nCSV processing completed successfully!')
    } catch (error) {
      console.error('Error processing CSV:', error)
      process.exit(1)
    }
  } else {
    // Interactive mode (existing functionality)
    console.log('Starting interactive mode. Use --help for more options.')
    const copilotClient = await createClient()
    const act: Activity = await copilotClient.startConversationAsync(true)
    console.log('\nSuggested Actions: ')
    act.suggestedActions?.actions.forEach((action: CardAction) => console.log(action.value))
    await askQuestion(copilotClient, act.conversation?.id!)
  }
}

main().catch(e => console.log(e))
