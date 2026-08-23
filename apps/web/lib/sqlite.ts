/**
 * SQLite を開くときの共通処理。
 *
 * ETL が書き込んでいる最中の DB は "database disk image is malformed" として見える
 * ことがある。**壊れているわけではない。** ETL は Docker コンテナの中から、
 * ビルドはホストから、同じファイルをバインドマウント越しに開いている。
 * Docker Desktop のファイル共有は POSIX ロックと mmap の一貫性を保証しないため、
 * 書き込み中のページを読むと壊れて見える。
 *
 * 短い書き込みなら待てば読めるので数回やり直す。それでも駄目なときは、
 * ETL の終了を待つかフィクスチャで開発してもらう。
 *
 * それでも駄目なときは**黙ってフィクスチャに落とさない**。本番ビルドで
 * ダミー 14 社を実データとして配信してしまうほうが、ビルドが失敗するより高くつく。
 */
import fs from 'node:fs';
import path from 'node:path';

/** ETL が実行中であることを示すファイル（pipeline/etl_lock.py が作る）。 */
export const ETL_LOCK_NAME = '.etl-running';

/**
 * ETL が動いている間は DB を開かない。**リトライもしない。**
 *
 * バインドマウント越しにコンテナ（ETL）とホスト（ビルド）から同じ SQLite を開くと、
 * POSIX ロックが効かず読むだけでファイルが壊れる。実際に一度壊している。
 * 「待てば読める」ではなく「触らない」を強制する。
 */
export function assertEtlNotRunning(dbPath: string): void {
  const lock = path.join(path.dirname(dbPath), ETL_LOCK_NAME);
  if (!fs.existsSync(lock)) return;

  let detail = '';
  try {
    const info = JSON.parse(fs.readFileSync(lock, 'utf8')) as {
      started_at?: string;
      host?: string;
    };
    detail = `（開始 ${info.started_at ?? '不明'} / 実行元 ${info.host ?? '不明'}）`;
  } catch {
    /* 壊れたロックでも「動いている」とみなす */
  }

  throw new Error(
    `ETL が実行中のため ${dbPath} を開けません${detail}。\n\n` +
      'ETL とビルドが同時に同じ SQLite を開くと、読むだけでファイルが壊れます。\n' +
      '（Docker のバインドマウント越しでは POSIX ロックが効かないため）\n\n' +
      '対処:\n' +
      '  - 終わるまで待つ:              docker compose logs -f etl\n' +
      '  - 待たずにフロントを触るなら:  COMPANIES_DB=/nonexistent.db npm run dev\n' +
      `  - ETL が異常終了して残っている場合のみ:  rm ${lock}\n`,
  );
}

export const OPEN_RETRIES = 5;
export const OPEN_RETRY_WAIT_MS = 400;

/** 同期的に待つ。ビルド時にしか通らない経路なので Atomics.wait で足りる。 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 書き込み中の DB でよく出る、待てば直る類のエラーか。 */
export function isTransientSqliteError(e: unknown): boolean {
  const message = String((e as { message?: string })?.message ?? e);
  return (
    message.includes('malformed') ||
    message.includes('locked') ||
    message.includes('busy') ||
    message.includes('SQLITE_BUSY') ||
    message.includes('SQLITE_CORRUPT')
  );
}

export function openWithRetry<T>(open: () => T, dbPath: string): T {
  let last: unknown;
  for (let i = 0; i < OPEN_RETRIES; i += 1) {
    try {
      return open();
    } catch (e) {
      last = e;
      if (!isTransientSqliteError(e)) throw e;
      if (i < OPEN_RETRIES - 1) sleepSync(OPEN_RETRY_WAIT_MS);
    }
  }
  throw new Error(
    `${dbPath} を読めませんでした（${OPEN_RETRIES} 回試行）。\n\n` +
      'ETL（docker compose の etl）が書き込み中の可能性が高いです。\n' +
      'Docker のバインドマウント越しにホストとコンテナの両方から SQLite を開くと、\n' +
      'ファイルロックが正しく効かず "malformed" として見えます。DB は壊れていません。\n\n' +
      '対処:\n' +
      '  - ETL の終了を待つ（docker compose logs -f etl）\n' +
      '  - 待たずにフロントを触るなら、ダミー 14 社で開発する:\n' +
      '      COMPANIES_DB=/nonexistent.db npm run dev\n\n' +
      `元のエラー: ${String((last as { message?: string })?.message ?? last)}`,
  );
}
