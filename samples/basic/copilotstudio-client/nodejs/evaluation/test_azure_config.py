#!/usr/bin/env python3
"""
Azure OpenAI Configuration Test Script

This script tests the Azure OpenAI configuration for RAGAS evaluation.
"""

import os
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings

def test_azure_openai_config():
    """Test Azure OpenAI configuration."""
    
    print("Testing Azure OpenAI Configuration")
    print("=" * 40)
    
    # Check environment variables
    required_vars = ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print(f"❌ Missing required environment variables: {', '.join(missing_vars)}")
        return False
    
    # Print configuration
    print("Configuration:")
    print(f"  Endpoint: {os.getenv('AZURE_OPENAI_ENDPOINT')}")
    print(f"  API Version: {os.getenv('AZURE_OPENAI_API_VERSION', '2024-02-01')}")
    print(f"  Model Deployment: {os.getenv('AZURE_OPENAI_MODEL_DEPLOYMENT', 'gpt-4')}")
    print(f"  Embedding Deployment: {os.getenv('AZURE_OPENAI_EMBEDDING_DEPLOYMENT', 'text-embedding-ada-002')}")
    
    try:
        # Test LLM
        print("\n🔄 Testing Azure OpenAI LLM...")
        azure_llm = AzureChatOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            deployment_name=os.getenv("AZURE_OPENAI_MODEL_DEPLOYMENT", "gpt-4"),
            temperature=0
        )
        
        # Simple test
        response = azure_llm.invoke("Hello, how are you?")
        print(f"✅ LLM Response: {response.content[:100]}...")
        
        # Test Embeddings
        print("\n🔄 Testing Azure OpenAI Embeddings...")
        azure_embeddings = AzureOpenAIEmbeddings(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            deployment=os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-ada-002")
        )
        
        # Simple embedding test
        embedding = azure_embeddings.embed_query("Hello world")
        print(f"✅ Embedding dimension: {len(embedding)}")
        
        print("\n✅ Azure OpenAI configuration test passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Azure OpenAI configuration test failed: {e}")
        return False

def test_environment_variables():
    """Test if all required environment variables are set."""
    
    print("\n" + "=" * 40)
    print("Environment Variables Check")
    print("=" * 40)
    
    # Azure OpenAI variables
    azure_vars = {
        "AZURE_OPENAI_API_KEY": "Azure OpenAI API Key",
        "AZURE_OPENAI_ENDPOINT": "Azure OpenAI Endpoint",
        "AZURE_OPENAI_API_VERSION": "Azure OpenAI API Version",
        "AZURE_OPENAI_MODEL_DEPLOYMENT": "Azure OpenAI Model Deployment",
        "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "Azure OpenAI Embedding Deployment"
    }
    
    for var, description in azure_vars.items():
        value = os.getenv(var)
        if value:
            # Mask API key for security
            if "API_KEY" in var:
                masked_value = value[:8] + "..." + value[-4:] if len(value) > 12 else "***"
                print(f"✅ {description}: {masked_value}")
            else:
                print(f"✅ {description}: {value}")
        else:
            print(f"❌ {description}: Not set")
    
    # OpenAI fallback
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        masked_key = openai_key[:8] + "..." + openai_key[-4:] if len(openai_key) > 12 else "***"
        print(f"✅ OpenAI API Key (fallback): {masked_key}")
    else:
        print(f"⚠️ OpenAI API Key (fallback): Not set")

def main():
    """Main function."""
    
    # Test environment variables
    test_environment_variables()
    
    # Test Azure OpenAI configuration
    success = test_azure_openai_config()
    
    if success:
        print("\n🎉 All tests passed! Ready to run RAGAS evaluation.")
    else:
        print("\n💡 Please check your Azure OpenAI configuration.")
        print("   Make sure the following environment variables are set:")
        print("   - AZURE_OPENAI_API_KEY")
        print("   - AZURE_OPENAI_ENDPOINT")
        print("   - AZURE_OPENAI_MODEL_DEPLOYMENT")
        print("   - AZURE_OPENAI_EMBEDDING_DEPLOYMENT")

if __name__ == "__main__":
    main()
