declare module "@google/generative-ai" {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    // 型は必要に応じて拡張可能だが、ここでは最低限にとどめる
    getGenerativeModel(options: any): any;
  }
}

