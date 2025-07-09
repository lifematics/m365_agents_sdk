#!/usr/bin/env python3
"""
RAGAS Evaluation Script for Q&A Data

This script evaluates question-answer pairs using RAGAS (Retrieval-Augmented Generation Assessment) metrics.
It reads data from sample_questions_with_answers.csv and computes various evaluation metrics.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any
import os
import sys
from datasets import Dataset
from ragas import evaluate
from ragas.metrics import (
    answer_relevancy,
    answer_correctness,
    answer_similarity,
    context_recall,
    context_precision,
    faithfulness
)
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings

def load_data(csv_path: str) -> pd.DataFrame:
    """Load Q&A data from CSV file."""
    try:
        df = pd.read_csv(csv_path)
        print(f"Successfully loaded {len(df)} records from {csv_path}")
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None

def prepare_ragas_dataset(df: pd.DataFrame) -> Dataset:
    """
    Prepare dataset for RAGAS evaluation.
    
    RAGAS expects:
    - question: The question asked
    - answer: The generated answer
    - contexts: List of retrieved contexts (using reference as context)
    - ground_truth: The expected answer (using reference as ground truth)
    """
    
    # Clean and prepare data
    questions = df['question'].tolist()
    answers = df['answer'].tolist()
    references = df['reference'].tolist()
    
    # For RAGAS, we need contexts as lists of strings
    # We'll use the reference as context for evaluation
    contexts = [[ref] for ref in references]
    
    # Ground truth is the expected answer (we'll use reference as ground truth)
    ground_truths = references
    
    # Create dataset dictionary
    dataset_dict = {
        'question': questions,
        'answer': answers,
        'contexts': contexts,
        'ground_truth': ground_truths
    }
    
    # Create HuggingFace Dataset
    dataset = Dataset.from_dict(dataset_dict)
    
    return dataset

def evaluate_with_ragas(dataset: Dataset, azure_llm=None, azure_embeddings=None) -> Dict[str, Any]:
    """
    Evaluate the dataset using RAGAS metrics with Azure OpenAI.
    
    Args:
        dataset: The dataset to evaluate
        azure_llm: Azure OpenAI LLM instance (optional)
        azure_embeddings: Azure OpenAI embeddings instance (optional)
    
    Returns:
        Dictionary containing evaluation results
    """
    
    # Define metrics to evaluate
    metrics = [
        answer_relevancy,      # How relevant is the answer to the question
        answer_correctness,    # How correct is the answer compared to ground truth
        answer_similarity,     # Semantic similarity between answer and ground truth
        context_recall,        # How much of the ground truth is covered by contexts
        context_precision,     # How precise are the contexts
        faithfulness          # How faithful is the answer to the contexts
    ]
    
    try:
        print("Starting RAGAS evaluation...")

        # Set environment variables for RAGAS to use Azure OpenAI
        if azure_llm and azure_embeddings:
            # print("Configuring RAGAS to use Azure OpenAI...")
            
            # # Set Azure OpenAI environment variables for RAGAS
            # os.environ["OPENAI_API_TYPE"] = "azure"
            # os.environ["OPENAI_API_VERSION"] = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01")
            # os.environ["OPENAI_API_BASE"] = os.getenv("AZURE_OPENAI_ENDPOINT", "")
            # os.environ["OPENAI_API_KEY"] = os.getenv("AZURE_OPENAI_API_KEY", "")
            
            # # Set deployment names
            # os.environ["OPENAI_DEPLOYMENT_NAME"] = os.getenv("AZURE_OPENAI_MODEL_DEPLOYMENT", "gpt-4")
            # os.environ["OPENAI_EMBEDDING_DEPLOYMENT"] = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
            result = evaluate(dataset, metrics=metrics, llm=azure_llm, embeddings=azure_embeddings)
        else:
            result = evaluate(dataset, metrics=metrics)
    
        
        print("RAGAS evaluation completed successfully!")
        return result
        
    except Exception as e:
        print(f"Error during evaluation: {e}")
        
        # Try fallback to standard OpenAI if Azure fails
        if azure_llm and azure_embeddings:
            print("Attempting fallback to standard OpenAI...")
            try:
                # Reset environment variables
                os.environ.pop("OPENAI_API_TYPE", None)
                os.environ.pop("OPENAI_API_BASE", None)
                os.environ.pop("OPENAI_DEPLOYMENT_NAME", None)
                os.environ.pop("OPENAI_EMBEDDING_DEPLOYMENT", None)
                
                result = evaluate(dataset, metrics=metrics)
                print("RAGAS evaluation completed with fallback OpenAI!")
                return result
            except Exception as fallback_error:
                print(f"Fallback evaluation also failed: {fallback_error}")
                return None
        else:
            return None

def display_results(result: pd.DataFrame):
    """Display evaluation results in a formatted way."""
    
    if result is None:
        print("No results to display.")
        return
    
    print("\n" + "="*60)
    print("RAGAS EVALUATION RESULTS")
    print("="*60)
    
    # Overall metrics
    print("\nOVERALL METRICS:")
    print("-" * 30)
    
    metric_names = {
        'answer_relevancy': 'Answer Relevancy',
        'answer_correctness': 'Answer Correctness',
        'answer_similarity': 'Answer Similarity', 
        'context_recall': 'Context Recall',
        'context_precision': 'Context Precision',
        'faithfulness': 'Faithfulness'
    }
    

    for metric_key, metric_name in metric_names.items():
        if metric_key in result:
            # Get individual scores for this category
            if hasattr(result, 'to_pandas'):
                result_df = result.to_pandas()
                if metric_key in result_df.columns:
                    category_scores = result_df.iloc[category_indices][metric_key]
                    avg_score = category_scores.mean()
                    print(f"  {metric_name:18}: {avg_score:.4f}")

def save_detailed_results(result_df: pd.DataFrame, output_path: str):
    """Save detailed results to CSV file."""
    
    if result_df is None:
        print("No results to save.")
        return
    
    try:
        # Convert result to DataFrame if possible
        # # Combine with original data
        # detailed_df = pd.concat([df, result_df], axis=1)
        
        # # Save to CSV
        # detailed_df.to_csv(output_path, index=False)
        result_df.to_csv(output_path, index=False)
        print(f"Detailed results saved to: {output_path}")
            
    except Exception as e:
        print(f"Error saving results: {e}")

def configure_azure_openai():
    """Configure Azure OpenAI settings for RAGAS evaluation."""
    
    # Azure OpenAI configuration
    azure_config = {
        "api_key": os.getenv("AZURE_OPENAI_API_KEY"),
        "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
        "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
        "model_deployment": os.getenv("AZURE_OPENAI_MODEL_DEPLOYMENT", "gpt-4"),
        "embedding_deployment": os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
    }
    
    # Check required environment variables
    required_vars = ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        print("Please set the following environment variables:")
        print("  AZURE_OPENAI_API_KEY=your-azure-openai-api-key")
        print("  AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/")
        print("  AZURE_OPENAI_MODEL_DEPLOYMENT=your-model-deployment-name")
        print("  AZURE_OPENAI_EMBEDDING_DEPLOYMENT=your-embedding-deployment-name")
        return None
    
    try:
        # Create Azure OpenAI LLM
        azure_llm = AzureChatOpenAI(
            api_key=azure_config["api_key"],
            api_version=azure_config["api_version"],
            azure_endpoint=azure_config["azure_endpoint"],
            deployment_name=azure_config["model_deployment"],
            model=azure_config["model_deployment"],
            temperature=0
        )
        
        # Create Azure OpenAI Embeddings
        azure_embeddings = AzureOpenAIEmbeddings(
            api_key=azure_config["api_key"],
            api_version=azure_config["api_version"],
            azure_endpoint=azure_config["azure_endpoint"],
            deployment=azure_config["embedding_deployment"],
            model=azure_config["embedding_deployment"]
        )
        
        print("✓ Azure OpenAI configured successfully")
        print(f"  Endpoint: {azure_config['azure_endpoint']}")
        print(f"  Model: {azure_config['model_deployment']}")
        print(f"  Embedding: {azure_config['embedding_deployment']}")
        
        return azure_llm, azure_embeddings
        
    except Exception as e:
        print(f"Error configuring Azure OpenAI: {e}")
        return None

def main():
    """Main function to run the RAGAS evaluation."""
    
    # Configuration
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "sample_questions_with_answers.csv"
    output_path = "ragas_evaluation_results.csv"
    
    print("RAGAS Evaluation Script with Azure OpenAI")
    print("="*40)
    
    # Configure Azure OpenAI
    print("\nConfiguring Azure OpenAI...")
    azure_config = configure_azure_openai()
    if azure_config is None:
        print("Falling back to default OpenAI configuration...")
        azure_llm, azure_embeddings = None, None
    else:
        azure_llm, azure_embeddings = azure_config
    
    # Check if input file exists
    if not os.path.exists(csv_path):
        print(f"Error: Input file '{csv_path}' not found.")
        return
    
    # Load data
    df = load_data(csv_path)
    if df is None:
        return
    
    print(f"Data shape: {df.shape}")
    print(f"Categories: {df['category'].unique().tolist()}")
    
    # Prepare dataset for RAGAS
    print("\nPreparing dataset for RAGAS evaluation...")
    dataset = prepare_ragas_dataset(df)
    
    # Evaluate with RAGAS
    print(f"dataset shape: {dataset.shape}")
    result = evaluate_with_ragas(dataset, azure_llm, azure_embeddings).to_pandas()
    print(f"Evaluation result: {result}")
    
    # Display results
    # display_results(result, df)
    
    # Save detailed results
    save_detailed_results(result, output_path)
    
    print(f"\nEvaluation complete!")

if __name__ == "__main__":
    main()
