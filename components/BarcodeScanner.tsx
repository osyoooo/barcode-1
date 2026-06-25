"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatOneDReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";

type SaveState = "idle" | "saving" | "saved" | "error";

type ApiResponse = {
  ok: boolean;
  row?: number;
  requestId?: string;
  error?: string;
};

type ScanLog = {
  barcode: string;
  readAt: string;
  status: "saved" | "error";
  message: string;
  row?: number;
  requestId?: string;
};

const STORAGE_OPERATOR_KEY = "barcode_scanner_operator";
const DUPLICATE_BLOCK_MS = 3000;

const ONE_D_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.CODABAR,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_8,
  BarcodeFormat.EAN_13,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
  BarcodeFormat.RSS_EXPANDED,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.UPC_EAN_EXTENSION,
];

function formatDateTimeForDisplay(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getBarcodeFormatName(format: BarcodeFormat | undefined) {
  if (typeof format !== "number") return "";
  return BarcodeFormat[format] ?? String(format);
}

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "カメラを起動できませんでした。ブラウザの権限設定を確認してください。";
  }

  if (error.name === "NotAllowedError") {
    return "カメラ権限が拒否されています。ブラウザ設定でこのサイトのカメラ使用を許可してください。";
  }

  if (error.name === "NotFoundError") {
    return "利用できるカメラが見つかりませんでした。";
  }

  if (error.name === "NotReadableError") {
    return "カメラを他のアプリが使用中の可能性があります。他のカメラアプリを閉じてから再試行してください。";
  }

  return `${error.name}: ${error.message}`;
}

function vibrateSuccess() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(80);
  }
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatOneDReader | null>(null);
  const savingRef = useRef(false);
  const lastScanRef = useRef<{ barcode: string; at: number } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [statusMessage, setStatusMessage] = useState("開始ボタンを押すとカメラが起動します。");
  const [errorMessage, setErrorMessage] = useState("");
  const [operator, setOperator] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [lastReadAt, setLastReadAt] = useState("");
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    const savedOperator = window.localStorage.getItem(STORAGE_OPERATOR_KEY);
    if (savedOperator) setOperator(savedOperator);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_OPERATOR_KEY, operator);
  }, [operator]);

  const stopScanning = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch (error) {
      console.warn("Failed to stop scanner", error);
    } finally {
      controlsRef.current = null;
      readerRef.current = null;
      setIsScanning(false);
      setStatusMessage("スキャンを停止しました。");
    }
  }, []);

  useEffect(() => {
    return () => stopScanning();
  }, [stopScanning]);

  const submitScan = useCallback(
    async (barcode: string, format: string) => {
      const normalizedBarcode = barcode.trim();
      if (!normalizedBarcode) return;

      const now = Date.now();
      const lastScan = lastScanRef.current;
      if (lastScan?.barcode === normalizedBarcode && now - lastScan.at < DUPLICATE_BLOCK_MS) {
        setStatusMessage("同じバーコードの連続送信を防止しました。別のコードを読むか、数秒待ってください。");
        return;
      }

      if (savingRef.current) {
        setStatusMessage("保存中です。完了後に次のバーコードを読み取ってください。");
        return;
      }

      lastScanRef.current = { barcode: normalizedBarcode, at: now };
      savingRef.current = true;

      const readAt = new Date().toISOString();
      setLastBarcode(normalizedBarcode);
      setLastReadAt(readAt);
      setSaveState("saving");
      setErrorMessage("");
      setStatusMessage(`読み取り成功: ${normalizedBarcode}。スプレッドシートへ保存中です。`);

      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            barcode: normalizedBarcode,
            readAt,
            format,
            operator: operator.trim(),
          }),
        });

        const data = (await response.json().catch(() => null)) as ApiResponse | null;
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error ?? `保存APIでエラーが発生しました。HTTP ${response.status}`);
        }

        vibrateSuccess();
        setSaveState("saved");
        setStatusMessage(`保存しました。行番号: ${data.row ?? "不明"}`);
        const nextLog: ScanLog = {
          barcode: normalizedBarcode,
          readAt,
          status: "saved",
          message: `保存済み${data.row ? ` / 行 ${data.row}` : ""}`,
          row: data.row,
          requestId: data.requestId,
        };
        setLogs((prev) => [nextLog, ...prev].slice(0, 10));
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存に失敗しました。";
        setSaveState("error");
        setErrorMessage(message);
        setStatusMessage("読み取りましたが、保存に失敗しました。通信状態と設定を確認してください。");
        const nextLog: ScanLog = {
          barcode: normalizedBarcode,
          readAt,
          status: "error",
          message,
        };
        setLogs((prev) => [nextLog, ...prev].slice(0, 10));
      } finally {
        savingRef.current = false;
      }
    },
    [operator],
  );

  const startScanning = useCallback(async () => {
    if (isScanning) return;
    setErrorMessage("");

    if (!window.isSecureContext) {
      setErrorMessage("カメラ利用にはHTTPSが必要です。Vercel本番URL、またはlocalhostで開いてください。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("このブラウザはカメラAPIに対応していません。Safari/Chromeの最新版で試してください。");
      return;
    }

    if (!videoRef.current) {
      setErrorMessage("video要素を初期化できませんでした。ページを再読み込みしてください。");
      return;
    }

    try {
      setIsScanning(true);
      setStatusMessage("カメラを起動しています。権限ダイアログが出たら許可してください。");

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, ONE_D_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatOneDReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: 1200,
        tryPlayVideoTimeout: 10000,
      });
      readerRef.current = reader;

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
        },
        audio: false,
      };

      const controls = await reader.decodeFromConstraints(
        constraints,
        videoRef.current,
        (result) => {
          if (!result) return;
          const barcode = result.getText().trim();
          const format = getBarcodeFormatName(result.getBarcodeFormat());
          void submitScan(barcode, format);
        },
      );

      controlsRef.current = controls;
      setStatusMessage("読み取りできます。バーコードを枠の中央に水平に合わせてください。");
    } catch (error) {
      setIsScanning(false);
      setErrorMessage(getCameraErrorMessage(error));
      setStatusMessage("カメラを起動できませんでした。");
    }
  }, [isScanning, submitScan]);

  const handleManualSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const barcode = manualCode.trim();
      if (!barcode) return;
      setManualCode("");
      await submitScan(barcode, "MANUAL");
    },
    [manualCode, submitScan],
  );

  return (
    <section className="card">
      <div className="header">
        <h1>バーコード読取 → Googleスプレッドシート</h1>
        <p>iOS/Androidのブラウザで一次元バーコードを読み取り、番号と読み取り日時を保存します。</p>
      </div>

      <div className="content">
        <div className="form-row">
          <label>
            担当者名 / 端末名（任意）
            <input
              className="input"
              value={operator}
              onChange={(event) => setOperator(event.target.value)}
              placeholder="例: 田中 / 倉庫A iPhone"
              autoComplete="name"
            />
          </label>
        </div>

        <div className="scanner-area" aria-label="バーコードスキャナー">
          <video ref={videoRef} muted playsInline autoPlay />
          <div className="scan-frame" aria-hidden="true">
            <div className="scan-line" />
          </div>
          <div className="status-bar">{statusMessage}</div>
        </div>

        <div className="controls">
          <div className="button-row">
            <button className="btn btn-primary" type="button" onClick={startScanning} disabled={isScanning}>
              カメラ開始
            </button>
            <button className="btn btn-danger" type="button" onClick={stopScanning} disabled={!isScanning}>
              停止
            </button>
          </div>
        </div>

        <div className="result-panel">
          <span className={`badge ${saveState}`}>{saveState === "idle" ? "待機中" : saveState === "saving" ? "保存中" : saveState === "saved" ? "保存済み" : "エラー"}</span>
          <div className="result-grid" style={{ marginTop: 12 }}>
            <span>直近コード</span>
            <strong>{lastBarcode || "-"}</strong>
            <span>読取日時</span>
            <strong>{lastReadAt ? formatDateTimeForDisplay(lastReadAt) : "-"}</strong>
          </div>
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </div>

        <form className="manual-form" onSubmit={handleManualSubmit}>
          <input
            className="manual-input"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="読み取れない場合は手入力"
            inputMode="numeric"
          />
          <button className="btn btn-secondary" type="submit" disabled={!manualCode.trim()}>
            手入力で保存
          </button>
        </form>

        <div className="log-panel">
          <h2>送信履歴（この端末のみ）</h2>
          {logs.length === 0 ? (
            <p className="log-meta">まだ送信履歴はありません。</p>
          ) : (
            <div className="log-list">
              {logs.map((log, index) => (
                <div className="log-item" key={`${log.readAt}-${log.barcode}-${index}`}>
                  <div className="log-code">{log.barcode}</div>
                  <div className="log-meta">
                    {formatDateTimeForDisplay(log.readAt)} / {log.status === "saved" ? "保存成功" : "保存失敗"} / {log.message}
                    {log.requestId ? ` / ID: ${log.requestId}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="notice-panel">
          <h2>読み取りのコツ</h2>
          <ul>
            <li>バーコードを横向きにして、枠の中央に大きく入れてください。</li>
            <li>暗い場所、反射、ピンぼけでは読み取りに時間がかかります。</li>
            <li>同じコードの連続送信は3秒間ブロックしています。</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
