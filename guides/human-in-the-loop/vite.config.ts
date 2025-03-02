import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import chalk from "chalk";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),

    {
      name: "requestLogger",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const timeString = new Date().toLocaleTimeString();
          console.log(
            `[${chalk.blue(timeString)}] ${chalk.green(
              req.method
            )} ${chalk.yellow(req.url)}`
          );
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      "agents-sdk": path.resolve(__dirname, "../../../packages/agents/dist")
    }
  }
});
