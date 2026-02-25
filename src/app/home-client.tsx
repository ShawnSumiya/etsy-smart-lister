"use client";

import imageCompression from "browser-image-compression";
import { useRef, useState } from "react";
import {
  UploadCloud,
  Image as ImageIcon,
  Sparkles,
  ClipboardCopy,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

type GeneratedResult = {
  title: string;
  tags: string[];
  description: string;
  snsPost: string;
};

export default function HomeClient() {
  const { addToast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCopy = (label: string, content: string) => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        addToast({
          title: "Copied",
          description: `${label} をクリップボードにコピーしました。`,
          duration: 2000,
        });
      })
      .catch(() => {
        addToast({
          title: "コピーに失敗しました",
          description: "お手数ですが手動でコピーしてください。",
          duration: 2000,
        });
      });
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = event.target.files;
    if (!fileList) return;

    const selectedFiles = Array.from(fileList);

    if (selectedFiles.length + images.length > 10) {
      addToast({
        title: "画像は最大10枚までです",
        description:
          "一度にアップロードできる画像は最大10枚までです。枚数を減らして再度お試しください。",
        duration: 2000,
      });
      event.target.value = "";
      return;
    }

    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1024,
      useWebWorker: true,
    };

    try {
      const compressedDataUrls = await Promise.all(
        selectedFiles.map(async (file) => {
          const compressedFile = await imageCompression(file, options);

          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result === "string") {
                resolve(result);
              } else {
                reject(new Error("画像の読み込みに失敗しました。"));
              }
            };
            reader.onerror = () =>
              reject(new Error("画像の読み込みに失敗しました。"));
            reader.readAsDataURL(compressedFile);
          });
        })
      );

      setImages((prev) => [...prev, ...compressedDataUrls]);
    } catch (error) {
      console.error(error);
      addToast({
        title: "画像の処理に失敗しました",
        description:
          "画像の圧縮または読み込み中にエラーが発生しました。時間をおいて再度お試しください。",
        duration: 2000,
      });
    } finally {
      event.target.value = "";
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    const trimmedKeyword = keyword.trim();

    if (!trimmedKeyword && images.length === 0) {
      addToast({
        title: "入力が不足しています",
        description: "画像または商品の特徴のいずれかを入力してください。",
        duration: 2000,
      });
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          images: images.length > 0 ? images : undefined,
          keyword: trimmedKeyword || undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "生成に失敗しました。");
      }

      const data = (await response.json()) as GeneratedResult;

      setResult(data);
      addToast({
        title: "生成が完了しました",
        description: "Etsy 出品データを生成しました。",
        duration: 2000,
      });
    } catch (error) {
      console.error(error);
      addToast({
        title: "エラーが発生しました",
        description:
          error instanceof Error
            ? error.message
            : "データ生成中に問題が発生しました。",
        duration: 2000,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-50">
      <header className="border-b border-slate-800/60 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-50">
                Etsy Smart Lister
              </p>
              <p className="text-xs text-slate-400">
                画像とキーワードから海外向け出品文を一括自動生成
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-slate-700/80 bg-slate-900/60 text-xs text-slate-200 hover:bg-slate-800 hover:text-slate-50"
          >
            ライセンス情報
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:flex-row">
        {/* 左カラム：入力エリア */}
        <section className="flex w-full flex-1 flex-col gap-4">
          <Card className="border-slate-800/80 bg-slate-950/70 shadow-xl shadow-slate-950/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-50">
                <UploadCloud className="h-4 w-4 text-sky-400" />
                入力エリア
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                商品画像をアップロードするか、日本語で商品の特徴を書くだけで OK です。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <label className="text-xs font-medium text-slate-300">
                  商品画像（任意）
                </label>
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700/80 bg-slate-900/60 px-4 py-8 text-center text-xs text-slate-400">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sky-400 ring-1 ring-slate-700">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-slate-100">
                      ここに画像をドラッグ＆ドロップ
                    </p>
                    <p className="text-[11px] text-slate-400">
                      または「ファイルを選択」ボタンからアップロード
                    </p>
                  </div>
                  <div className="mt-2 flex flex-col items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      multiple
                      onChange={handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="border-slate-700 bg-slate-900/80 text-[11px] text-slate-100 hover:bg-slate-800"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isGenerating}
                    >
                      画像ファイルを選択
                    </Button>
                    {images.length > 0 && (
                      <p className="text-[11px] text-slate-400">
                        {images.length}枚の画像が選択されています（最大10枚）。
                      </p>
                    )}
                  </div>
                  {images.length > 0 && (
                    <div className="mt-3 w-full">
                      <p className="mb-2 text-[11px] text-slate-400">
                        選択中の画像サムネイル
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                        {images.map((img, index) => (
                          <div
                            key={index}
                            className="relative overflow-hidden rounded-lg border border-slate-700 bg-slate-900/80"
                          >
                            <img
                              src={img}
                              alt={`選択画像 ${index + 1}`}
                              className="h-20 w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(index)}
                              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-slate-100 hover:bg-black/90"
                              aria-label={`画像${index + 1}を削除`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3">
                <label className="text-xs font-medium text-slate-300">
                  商品の特徴（日本語で OK）
                </label>
                <Textarea
                  placeholder="例）ハンドメイドのシルバーリング。ミニマルでシンプルなデザイン。ギフト向け。金属アレルギー対策済み。"
                  className="min-h-[140px] resize-none bg-slate-900/80 text-xs text-slate-100 placeholder:text-slate-500"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  disabled={isGenerating}
                />
                <p className="text-[11px] text-slate-500">
                  素材・サイズ・ターゲット・利用シーンなどをできるだけ詳しく書くほど、精度が上がります。
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  className="inline-flex items-center gap-2 bg-sky-500 text-xs font-semibold text-white hover:bg-sky-400"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  <Sparkles className="h-4 w-4" />
                  {isGenerating ? "生成中..." : "Etsy 出品データを一括生成"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 右カラム：出力エリア */}
        <section className="flex w-full flex-1 flex-col gap-4">
          <Card className="border-slate-800/80 bg-slate-950/70 shadow-xl shadow-slate-950/60">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base font-semibold text-slate-50">
                生成結果プレビュー
                <span className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-700">
                  {isGenerating ? "Generating..." : "Live Preview"}
                </span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                画像とテキストから生成された Etsy 出品データのプレビューです。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {isGenerating ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-2/3 bg-slate-800" />
                  <Skeleton className="h-4 w-full bg-slate-800" />
                  <Skeleton className="h-4 w-5/6 bg-slate-800" />
                  <Skeleton className="h-4 w-4/5 bg-slate-800" />
                </div>
              ) : result ? (
                <>
                  <OutputBlock
                    label="Title"
                    helper="Etsy の SEO を意識した 140 文字以内の英語タイトル"
                    content={result.title}
                    onCopy={() => handleCopy("Title", result.title)}
                  />
                  <OutputBlock
                    label="SEO Tags"
                    helper="英語カンマ区切り、最大 13 個"
                    content={result.tags.join(", ")}
                    onCopy={() =>
                      handleCopy("SEO Tags", result.tags.join(", "))
                    }
                  />
                  <OutputBlock
                    label="Description"
                    helper="魅力的で自然な英語の商品説明文"
                    content={result.description}
                    onCopy={() =>
                      handleCopy("Description", result.description)
                    }
                  />
                  <OutputBlock
                    label="SNS Post"
                    helper="Instagram / Pinterest 向け英語プロモーション文（ハッシュタグ付き）"
                    content={result.snsPost}
                    onCopy={() => handleCopy("SNS Post", result.snsPost)}
                  />
                </>
              ) : (
                <p className="text-[11px] text-slate-500">
                  左側で画像または商品の特徴を入力し、「Etsy 出品データを一括生成」をクリックすると、ここに結果が表示されます。
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

type OutputBlockProps = {
  label: string;
  helper: string;
  content: string;
  onCopy: () => void;
};

function OutputBlock({ label, helper, content, onCopy }: OutputBlockProps) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-800/70 bg-slate-900/70 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-100">{label}</p>
          <p className="text-[11px] text-slate-500">{helper}</p>
        </div>
        <Button
          variant="outline"
          className="h-7 gap-1 border-slate-700 bg-slate-900/80 px-2 text-[11px] text-slate-100 hover:bg-slate-800"
          onClick={onCopy}
        >
          <ClipboardCopy className="h-3 w-3" />
          コピー
        </Button>
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-100">
        {content.split("\n").map((line, index) => (
          <p key={index} className={index > 0 ? "mt-1.5" : ""}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

