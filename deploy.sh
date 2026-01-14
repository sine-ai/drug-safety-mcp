#!/bin/bash
set -e

# ============================================================================
# DRUG SAFETY MCP DEPLOYMENT SCRIPT
# ============================================================================
# Deployment Mode: STANDALONE (no @sineai/mcp-core dependency)
# Auth: Via MCP Gateway (OAuth 2.0 with Microsoft/Google)
#
# All infrastructure config is fetched from Azure Key Vault.
# Only AZURE_KEYVAULT_NAME is required in .env
#
# Key Vault secrets used:
#   - azure-acr-name
#   - azure-resource-group
#   - azure-container-environment
#   - mcp-gateway-url
# ============================================================================

# Source .env file if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

APP_NAME="drug-safety-mcp"

# ============================================================================
# STEP 0: Get configuration from Key Vault
# ============================================================================
echo "🔐 Loading configuration from Key Vault..."
echo "   Fetching secrets from ${AZURE_KEYVAULT_NAME:-'(not set)'}..."

# Key Vault name is required
if [ -z "$AZURE_KEYVAULT_NAME" ] || [ "$AZURE_KEYVAULT_NAME" = '$(AZURE_KEYVAULT_NAME)' ]; then
    echo "❌ Error: AZURE_KEYVAULT_NAME is not set"
    echo ""
    echo "   Set it in one of these places:"
    echo "   1. Pipeline variable: AZURE_KEYVAULT_NAME = your-keyvault-name"
    echo "   2. Variable group linked to pipeline"
    echo "   3. .env file: AZURE_KEYVAULT_NAME=your-keyvault-name"
    exit 1
fi
KEYVAULT_NAME="$AZURE_KEYVAULT_NAME"

# Construct Key Vault URL if not provided
KEYVAULT_URL="${AZURE_KEYVAULT_URL:-https://$KEYVAULT_NAME.vault.azure.net/}"

# Check Azure login (AzureCLI task handles this in pipeline, manual login for local)
if ! az account show &> /dev/null; then
    echo "⚠️  Not logged in to Azure CLI"
    echo "   For local: run 'az login'"
    echo "   For pipeline: ensure AzureCLI task is configured with Service Connection"
    exit 1
fi

# Fetch infrastructure config from Key Vault
echo "   Fetching secrets from $KEYVAULT_NAME..."

ACR_NAME=$(az keyvault secret show --vault-name $KEYVAULT_NAME --name azure-acr-name --query value -o tsv 2>/dev/null)
if [ -z "$ACR_NAME" ]; then
    echo "❌ Secret 'azure-acr-name' not found in Key Vault"
    echo "   Run: az keyvault secret set --vault-name $KEYVAULT_NAME --name azure-acr-name --value <your-acr-name>"
    exit 1
fi

RESOURCE_GROUP=$(az keyvault secret show --vault-name $KEYVAULT_NAME --name azure-resource-group --query value -o tsv 2>/dev/null)
if [ -z "$RESOURCE_GROUP" ]; then
    echo "❌ Secret 'azure-resource-group' not found in Key Vault"
    echo "   Run: az keyvault secret set --vault-name $KEYVAULT_NAME --name azure-resource-group --value <your-rg>"
    exit 1
fi

ENVIRONMENT=$(az keyvault secret show --vault-name $KEYVAULT_NAME --name azure-container-environment --query value -o tsv 2>/dev/null)
if [ -z "$ENVIRONMENT" ]; then
    echo "❌ Secret 'azure-container-environment' not found in Key Vault"
    echo "   Run: az keyvault secret set --vault-name $KEYVAULT_NAME --name azure-container-environment --value <your-env>"
    exit 1
fi

GATEWAY_URL=$(az keyvault secret show --vault-name $KEYVAULT_NAME --name mcp-gateway-url --query value -o tsv 2>/dev/null || echo "")

echo "   ✅ Configuration loaded"

echo ""
echo "🚀 Deploying $APP_NAME to Azure Container Apps..."
echo "   Mode:           STANDALONE (no mcp-core)"
echo "   Key Vault:      $KEYVAULT_NAME"
echo "   ACR:            $ACR_NAME"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Environment:    $ENVIRONMENT"
echo "   Gateway:        ${GATEWAY_URL:-'(not set)'}"


# ============================================================================
# STEP 1: Build
# ============================================================================
echo ""
echo "[1/4] Installing dependencies & Building..."
npm ci
npm run build

# ============================================================================
# STEP 2: Docker Build
# ============================================================================
echo ""
echo "[2/4] Building Docker image..."

# No NPM_TOKEN needed - drug-safety-mcp uses only public packages (@modelcontextprotocol/sdk)
MAX_RETRIES=3
RETRY_COUNT=0
until az acr build --registry $ACR_NAME --image $APP_NAME:latest --platform linux/amd64 .; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ ACR build failed after $MAX_RETRIES attempts"
        exit 1
    fi
    echo "⚠️ ACR build failed, retrying ($RETRY_COUNT/$MAX_RETRIES)..."
    sleep 5
done

# ============================================================================
# STEP 3: Deploy to Container Apps
# ============================================================================
echo ""
echo "[3/4] Deploying to Container Apps..."

# Build environment variables
ENV_VARS="MCP_MODE=remote"
if [ -n "$GATEWAY_URL" ]; then
    ENV_VARS="$ENV_VARS OAUTH_ENABLED=true MCP_GATEWAY_URL=$GATEWAY_URL"
fi

if az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az containerapp update --name $APP_NAME --resource-group $RESOURCE_GROUP --image $ACR_NAME.azurecr.io/$APP_NAME:latest
else
    az containerapp create \
        --name $APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --environment $ENVIRONMENT \
        --image $ACR_NAME.azurecr.io/$APP_NAME:latest \
        --target-port 3000 \
        --ingress external \
        --min-replicas 0 \
        --max-replicas 5 \
        --cpu 0.25 \
        --memory 0.5Gi \
        --env-vars $ENV_VARS \
        --registry-server $ACR_NAME.azurecr.io \
        --system-assigned
fi

# Get URL
URL=$(az containerapp show -n $APP_NAME -g $RESOURCE_GROUP --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "============================================================================"
echo "✅ Deployment Complete!"
echo "============================================================================"
echo ""
echo "   URL:     https://$URL"
echo "   Health:  https://$URL/health"
echo "   MCP:     https://$URL/mcp"
echo ""
echo "   Cursor config:"
echo '   { "mcpServers": { "drug-safety": { "url": "https://'$URL'/mcp" } } }'
echo ""
if [ -n "$GATEWAY_URL" ]; then
    echo "   OAuth:   ENABLED via MCP Gateway"
    echo "   Users can sign in with Microsoft or Google accounts"
else
    echo "   OAuth:   DISABLED (no MCP_GATEWAY_URL)"
fi
echo ""
