import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildImageParts, SYSTEM_INSTRUCTION, type ImagePart } from "./schema";

export type GenerateInput = {
  keyword: string;
  imageParts: ImagePart[];
};

export type ListingGenerator = (input: GenerateInput) => Promise<unknown>;

let generatorOverride: ListingGenerator | null = null;

export function setListingGeneratorForTests(generator: ListingGenerator | null) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Listing generator override is disabled in production");
  }
  generatorOverride = generator;
}

export function getListingGenerator(): ListingGenerator {
  return generatorOverride ?? generateWithGemini;
}

async function generateWithGemini(input: GenerateInput): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const userPromptLines: string[] = [];
  if (input.keyword) {
    userPromptLines.push(`日本語で与えられた商品の特徴・キーワード: ${input.keyword}`);
  }
  if (input.imageParts.length > 0) {
    userPromptLines.push(
      "添付された複数の商品画像から特徴・素材・カラー・テイスト・利用シーン、バリエーションやセット内容なども推測し、テキスト情報と組み合わせて最適な出品データを作成してください。"
    );
  }
  userPromptLines.push(
    "Etsy の検索トレンドや購買意欲を高める自然な英語表現を意識し、事実と異なる表現や誇大広告は避けてください。title は140文字以内、tags はちょうど13個で各20文字以内、xPost と instagramPost は別々の文章にしてください。出力は指定された JSON 構造のみで返してください。"
  );

  const result = await model.generateContent([userPromptLines.join("\n"), ...input.imageParts]);
  const text = result.response.text();
  return JSON.parse(text) as unknown;
}

export function toGenerateInput(keyword: string, images: string[]): GenerateInput {
  return {
    keyword,
    imageParts: buildImageParts(images),
  };
}
