export const MAX_IMAGES = 10;
export const MAX_TITLE_LENGTH = 140;
export const TAG_COUNT = 13;
export const MAX_TAG_LENGTH = 20;

export const SYSTEM_INSTRUCTION = `
あなたはEtsyのトップセラーコンサルタントであり、プロのネイティブ英語コピーライターです。ユーザーから提供された「複数の商品画像」と「キーワード」を総合的に分析してください。複数の画像が含まれている場合、それらは商品のバリエーション、セット内容、または使用例を示しています。すべての画像から読み取れる情報（色違い、枚数、特典など）を正確に把握し、以下のJSONスキーマに従ってEtsyで売れるための最適な英語の出品データを生成してください。

【出力形式】
以下の構造を持つJSON形式で出力してください。
{
  "title": "EtsyのSEOを意識した英語タイトル。⚠️重要：絵文字（Emoji）は絶対に使用しないでください。また、特殊記号（%、&、:）の使用も避けてください。単語やフレーズの区切りには、パイプライン（|）やカンマ（,）、ハイフン（-）を使用すること。必ず140文字以内に厳守し（文字数超過はシステムエラーになります。120〜135文字を目安にしてください）、重要な検索語句を前半に配置してください。",
  "tags": ["tag1", "tag2"], // 英語のSEOタグを正確に13個。1つのタグは20文字以内で、複数単語の組み合わせ（例: 'custom digital art'）を推奨。
  "description": "魅力的で自然な英語の商品説明文。⚠️重要：Markdownの箇条書き記号（* や -）の多用は厳禁です。箇条書きは最小限に留め、入れ子（箇条書きの中の箇条書き）は絶対にしないでください。記号を並べる代わりに、自然な段落分け（パラグラフ）や、見出しと短い文章の組み合わせでスッキリと構成してください。適度に絵文字（✨, 🎰, 💎など）を文頭に使用して、視覚的に楽しく読みやすい洗練されたレイアウトにすること。商品の魅力が伝わる導入、セット内容、用途、およびデジタル商品の注意点を含めてください。",
  "xPost": "X(旧Twitter)向けの英語プロモーションテキスト。Instagram用とは別の文章にしてください。⚠️重要：ハッシュタグ、絵文字、スペースをすべて含めて【絶対に200文字以内】で出力してください。本文は非常に短く簡潔（130文字程度）にし、最後に短いハッシュタグを2〜3個だけ付けてください。",
  "instagramPost": "Instagram向けの英語プロモーションテキスト。X用とは別の文章にしてください。導入文、商品の魅力、行動喚起を自然な段落で書き、最後に関連ハッシュタグを付けてください。X投稿の短縮版を繰り返さないでください。"
}
`;

export type ImagePart = { inlineData: { data: string; mimeType: string } };

export type Listing = {
  title: string;
  tags: string[];
  description: string;
  xPost: string;
  instagramPost: string;
};

function charLength(value: string): number {
  return Array.from(value).length;
}

function sliceChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join("");
}

export function buildImageParts(images?: string[] | null): ImagePart[] {
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

export function normalizeListing(raw: unknown): { ok: true; value: Listing } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "生成結果の形式が不正です。" };
  }

  const record = raw as Record<string, unknown>;
  let title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) {
    return { ok: false, error: "英語タイトルを生成できませんでした。" };
  }
  if (charLength(title) > MAX_TITLE_LENGTH) {
    const cut = sliceChars(title, MAX_TITLE_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace >= 100 ? cut.slice(0, lastSpace) : cut).trim();
  }
  if (!title || charLength(title) > MAX_TITLE_LENGTH) {
    return { ok: false, error: "英語タイトルは140文字以内である必要があります。" };
  }

  if (!Array.isArray(record.tags)) {
    return { ok: false, error: "SEOタグは13個、各20文字以内である必要があります。" };
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of record.tags) {
    if (typeof tag !== "string") continue;
    const normalized = sliceChars(tag.trim(), MAX_TAG_LENGTH).trim();
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized);
    if (tags.length === TAG_COUNT) break;
  }

  if (tags.length !== TAG_COUNT || tags.some((tag) => charLength(tag) > MAX_TAG_LENGTH)) {
    return { ok: false, error: "SEOタグは13個、各20文字以内である必要があります。" };
  }

  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!description) {
    return { ok: false, error: "商品説明を生成できませんでした。" };
  }

  const xPost = typeof record.xPost === "string" ? record.xPost.trim() : "";
  const instagramPost = typeof record.instagramPost === "string" ? record.instagramPost.trim() : "";
  if (!xPost || !instagramPost) {
    return { ok: false, error: "X用とInstagram用の文章を生成できませんでした。" };
  }

  return {
    ok: true,
    value: { title, tags, description, xPost, instagramPost },
  };
}
