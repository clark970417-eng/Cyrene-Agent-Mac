// Vision Co-pilot 共享型別定義

export interface VisionCopilotRequest {
  question?: string;
  imagePath?: string;
  base64Image?: string;
  autoSpeak?: boolean;
}

export interface VisionCopilotResponse {
  analysis: string;
  suggestions: string[];
  speechText?: string;
  timestamp: number;
}
