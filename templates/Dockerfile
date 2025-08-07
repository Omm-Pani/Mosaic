FROM node:18-alpine AS base
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package management files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile


# --- Development Stage ---
# This stage is used for running the app in development mode with hot-reloading
FROM base AS dev
WORKDIR /app

# Copy the rest of the application code
COPY . .

# --- Google Cloud SDK Installation for Gemini CLI ---
# This allows the in-VM fixer agent to make authenticated calls to Gemini
RUN apk add --no-cache bash curl
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-component-only gcloud

# Set the path to include the gcloud CLI
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"

# Expose the port the app runs on
EXPOSE 3000

# The command to run the app in development mode (with hot-reloading)
CMD ["pnpm", "run", "dev"]


# --- Production Stage (Optional, for a production build) ---
FROM base AS prod
WORKDIR /app

# Copy built artifacts from the dev stage (if you were to run `pnpm build`)
COPY --from=dev /app/.next ./.next
COPY --from=dev /app/public ./public
COPY --from=dev /app/package.json ./package.json

EXPOSE 3000

# The command to run the app in production mode
CMD ["pnpm", "start"]
