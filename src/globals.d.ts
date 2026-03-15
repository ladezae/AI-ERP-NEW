declare const GEMINI_API_KEY: string;

interface Window {
  aistudio: {
    hasSelectedApiKey(): Promise<boolean>;
    openSelectKey(): Promise<void>;
  };
}
