export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingBody = {
  barcode?: unknown;
  readAt?: unknown;
  operator?: unknown;
  format?: unknown;
};

type GasResponse = {
  ok?: boolean;
  row?: number;
  requestId?: string;
  error?: string;
};

const MAX_BARCODE_LENGTH = 256;

function requiredEnv(name: "GAS_WEB_APP_URL" | "GAS_SHARED_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} が未設定です。`);
  return value;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function validIsoDateOrNow(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return new Date().toISOString();

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function parseJson(request: Request): Promise<IncomingBody | null> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") return null;
    return body as IncomingBody;
  } catch {
    return null;
  }
}

export async function GET() {
  return Response.json({ ok: true, message: "Barcode scan API is running." });
}

export async function POST(request: Request) {
  try {
    const body = await parseJson(request);
    if (!body) {
      return Response.json({ ok: false, error: "JSON body が必要です。" }, { status: 400 });
    }

    const barcode = cleanText(body.barcode, MAX_BARCODE_LENGTH);
    if (!barcode) {
      return Response.json({ ok: false, error: "barcode が空です。" }, { status: 400 });
    }

    const gasWebAppUrl = requiredEnv("GAS_WEB_APP_URL");
    const sharedSecret = requiredEnv("GAS_SHARED_SECRET");

    const payload = {
      secret: sharedSecret,
      barcode,
      readAt: validIsoDateOrNow(body.readAt),
      operator: cleanText(body.operator, 100),
      format: cleanText(body.format, 64),
      userAgent: request.headers.get("user-agent") ?? "",
      appReceivedAt: new Date().toISOString(),
    };

    const gasResponse = await fetch(gasWebAppUrl, {
      method: "POST",
      headers: {
        // Apps Script 側で e.postData.contents としてそのまま受け取るため text/plain にしています。
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "follow",
    });

    const responseText = await gasResponse.text();
    let data: GasResponse | null = null;
    try {
      data = JSON.parse(responseText) as GasResponse;
    } catch {
      data = null;
    }

    if (!gasResponse.ok) {
      return Response.json(
        {
          ok: false,
          error: `Google Apps Script が HTTP ${gasResponse.status} を返しました。`,
          detail: responseText.slice(0, 500),
        },
        { status: 502 },
      );
    }

    if (!data?.ok) {
      return Response.json(
        {
          ok: false,
          error: data?.error ?? "Google Apps Script 側で保存に失敗しました。",
        },
        { status: 502 },
      );
    }

    return Response.json({ ok: true, row: data.row, requestId: data.requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラーです。";
    console.error("/api/scan error", error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
