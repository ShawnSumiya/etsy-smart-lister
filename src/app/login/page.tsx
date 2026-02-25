"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [licenseKey, setLicenseKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedKey = licenseKey.trim();
    if (!trimmedKey) {
      addToast({
        title: "ライセンスキーを入力してください",
        description: "メールで送付されたライセンスキーを入力してください。",
        duration: 2000,
      });
      return;
    }

    setIsLoading(true);

    try {
      const nowIso = new Date().toISOString();

      const { data, error } = await supabase
        .from("license_keys")
        .select("*")
        .eq("key", trimmedKey)
        .eq("is_active", true)
        .gt("expires_at", nowIso)
        .maybeSingle();

      if (error) {
        console.error(error);
        throw new Error("ライセンスキーの確認中にエラーが発生しました。");
      }

      if (!data) {
        addToast({
          title: "ライセンスキーが無効です",
          description:
            "キーが存在しないか、無効化されているか、有効期限が切れています。",
          duration: 2000,
        });
        return;
      }

      const maxAgeDays = 7;
      const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;

      document.cookie = `session_token=valid; path=/; max-age=${maxAgeSeconds}; sameSite=Lax`;

      addToast({
        title: "ログインしました",
        description: "Etsy Smart Lister へリダイレクトします。",
        duration: 2000,
      });

      router.push("/");
    } catch (err) {
      console.error(err);
      addToast({
        title: "認証エラー",
        description:
          err instanceof Error
            ? err.message
            : "ライセンスキーの確認中に問題が発生しました。",
        duration: 2000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
      <div className="w-full max-w-md">
        <Card className="border-slate-800 bg-slate-950/60 shadow-xl shadow-slate-950/60 backdrop-blur">
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-sky-400">
              <LogIn className="h-4 w-4" />
              <span>License Access</span>
            </div>
            <CardTitle className="mt-2 text-2xl font-semibold text-slate-50">
              Etsy Smart Lister
            </CardTitle>
            <CardDescription className="text-slate-400">
              発行されたライセンスキーを入力して、Etsy向け出品データ自動生成ツールにアクセスします。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200">
                  ライセンスキー
                </label>
                <Input
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="bg-slate-900/80 text-slate-50 placeholder:text-slate-500"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  disabled={isLoading}
                />
                <p className="text-xs text-slate-500">
                  メールで送付されたシリアルキーをそのまま入力してください。
                </p>
              </div>

              <Button
                type="submit"
                className="w-full bg-sky-500 text-white hover:bg-sky-400"
                disabled={isLoading}
              >
                {isLoading ? "認証中..." : "ダッシュボードに入る"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <p className="w-full text-center text-[11px] leading-relaxed text-slate-500">
              ライセンスキーに問題がある場合は、購入時のメールアドレスからサポートまでお問い合わせください。
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

