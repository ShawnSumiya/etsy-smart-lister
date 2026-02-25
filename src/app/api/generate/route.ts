import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not set");
}

const genAI = new GoogleGenerativeAI(apiKey);

const SYSTEM_INSTRUCTION = `
あなたはEtsyのトップセラーコンサルタントであり、プロのネイティブ英語コピーライターです。ユーザーから提供された「複数の商品画像」と「キーワード」を総合的に分析してください。複数の画像が含まれている場合、それらは商品のバリエーション、セット内容、または使用例を示しています。すべての画像から読み取れる情報（色違い、枚数、特典など）を正確に把握し、以下のJSONスキーマに従ってEtsyで売れるための最適な英語の出品データを生成してください。

【出力形式】
以下の構造を持つJSON形式で出力してください。
{
  "title": "EtsyのSEOを意識した英語タイトル。絶対に140文字以内に厳守してください（文字数超過はシステムエラーになります。120〜135文字を目安にしてください）。重要な検索語句を前半に配置し、スパム的な羅列ではなく自然なフレーズにしてください。",
  "tags": ["tag1", "tag2"], // 英語のSEOタグを正確に13個。1つのタグは20文字以内で、複数単語の組み合わせ（例: 'custom digital art'）を推奨。
  "description": "魅力的で自然な英語の商品説明文。適度に絵文字（✨, 🎰, 💎, 🎮など）を使用して、視覚的に楽しく読みやすい構成にしてください。商品の魅力が伝わる導入、箇条書きのセット内容や特徴、想定される用途、およびデジタル商品の注意点を含めてください。",
  "snsPost": "X(旧Twitter)やInstagram向けの魅力的な英語プロモーションテキスト。Xの文字数制限（半角英数字280文字以内）を絶対に厳守してください。スペース、絵文字、ハッシュタグすべてを含めて【全体で250文字以内】に収まるよう、短くパンチの効いた文章にすること。絵文字を適度に使用し、最後に適切なハッシュタグを3〜5個つけてください。"
}
`;

type ImagePart = { inlineData: { data: string; mimeType: string } };

type RequestBody = {
  images?: string[] | null;
  keyword?: string | null;
};

function buildImageParts(images?: string[] | null): ImagePart[] {
  if (!images || images.length === 0) return [];

  const parts: ImagePart[] = [];

  for (const image of images) {
    if (!image) continue;

    let mimeType = "image/png";
    let base64Data = image;

    const match = image.match(/^data:(.+);base64,(.*)$/);
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }

    parts.push({
      inlineData: {
        data: base64Data,
        mimeType,
      },
    });
  }

  return parts;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const { images, keyword } = body;

    if ((!images || images.length === 0) && !keyword) {
      return NextResponse.json(
        { error: "images または keyword のいずれかは必須です。" },
        { status: 400 }
      );
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const imageParts = buildImageParts(images);

    const userPromptLines: string[] = [];

    if (keyword) {
      userPromptLines.push(
        `日本語で与えられた商品の特徴・キーワード: ${keyword}`
      );
    }

    if (imageParts.length > 0) {
      userPromptLines.push(
        "添付された複数の商品画像から特徴・素材・カラー・テイスト・利用シーン、バリエーションやセット内容なども推測し、テキスト情報と組み合わせて最適な出品データを作成してください。"
      );
    }

    userPromptLines.push(
      "Etsy の検索トレンドや購買意欲を高める自然な英語表現を意識し、事実と異なる表現や誇大広告は避けてください。出力は指定された JSON 構造のみで返してください。"
    );

    const promptText = userPromptLines.join("\n");

    const result = await model.generateContent([promptText, ...imageParts]);

    const text = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return NextResponse.json(
        {
          error: "Gemini からのレスポンスを JSON として解析できませんでした。",
          raw: text,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Error in /api/generate:", error);
    return NextResponse.json(
      {
        error: "予期せぬエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}

