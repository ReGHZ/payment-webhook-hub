FROM mcr.microsoft.com/devcontainers/typescript-node:24

# Symlink .claude to workspace so it persists across rebuilds
RUN ln -sf /workspaces/payment-webhook-hub/.claude /home/node/.claude
