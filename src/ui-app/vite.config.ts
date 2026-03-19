import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../../dist/ui", // Output into the main package's dist folder
    emptyOutDir: true,
  },
});
