export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  shortExplanation?: string;
  explanation: string;
  subject: string;
}

export interface UserAnswer {
  questionId: string;
  selectedOptionIndex: number;
  isCorrect: boolean;
}

export interface WrongAnswerRecord {
  id?: string; // Firestore document ID
  question: Question;
  failedAt: number; // timestamp
  correctCount?: number; 
  topic?: string;
}
