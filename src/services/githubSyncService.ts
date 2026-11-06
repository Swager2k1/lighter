/**
 * Сервис атомарной синхронизации файлов с GitHub репозиторием через REST API v3.
 * Не требует наличия установленного git CLI в облачном контейнере.
 * Включает последовательную очередь (Queue) и авто-повтор при конфликтах 409 (Race condition).
 */

export interface GithubSyncOptions {
  token?: string;
  repo?: string;
  branch?: string;
}

export interface SyncResult {
  success: boolean;
  status?: number;
  commitSha?: string;
  reason?: string;
  error?: string;
}

export class GithubSyncService {
  private token: string;
  private repo: string;
  private branch: string;
  private queue: Promise<any> = Promise.resolve();

  constructor(options?: GithubSyncOptions) {
    this.token = options?.token ?? (process.env.GITHUB_PAT || '');
    this.repo = options?.repo ?? (process.env.GITHUB_REPO || 'Swager2k1/Lighter');
    this.branch = options?.branch ?? (process.env.GITHUB_BRANCH || 'main');
  }

  /**
   * Проверка готовности сервиса к работе
   */
  public isConfigured(): boolean {
    return Boolean(this.token && this.token.trim().length > 0);
  }

  /**
   * Получение текущего SHA файла в репозитории (null если файл не существует)
   */
  public async getFileSha(filePath: string): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const cleanPath = filePath.replace(/^\/+/, '');
    const url = `https://api.github.com/repos/${this.repo}/contents/${cleanPath}?ref=${this.branch}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'LighterHedger-CloudWorker',
        },
      });

      if (res.status === 200) {
        const data = (await res.json()) as { sha?: string };
        return data.sha || null;
      }

      if (res.status === 404) {
        return null;
      }

      const errText = await res.text();
      console.warn(`[GithubSync] Не удалось получить SHA для ${cleanPath} (статус ${res.status}): ${errText}`);
      return null;
    } catch (err: any) {
      console.error(`[GithubSync] Ошибка сети при получении SHA для ${cleanPath}:`, err?.message || err);
      return null;
    }
  }

  /**
   * Постановка коммита в последовательную очередь (предотвращает параллельные гонки запросов)
   */
  public async syncFile(
    filePath: string,
    content: string,
    commitMessage: string
  ): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return { success: false, reason: 'missing_token' };
    }

    return new Promise((resolve) => {
      this.queue = this.queue
        .then(() => this.executeSyncWithRetry(filePath, content, commitMessage))
        .then(resolve)
        .catch((err: any) => resolve({ success: false, error: err?.message || String(err) }));
    });
  }

  /**
   * Выполнение коммита с повторами при конфликтах 409 (Race condition сдвига ветки)
   */
  private async executeSyncWithRetry(
    filePath: string,
    content: string,
    commitMessage: string,
    maxRetries: number = 3
  ): Promise<SyncResult> {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      const result = await this.performSingleCommit(filePath, content, commitMessage);
      if (result.success) {
        return result;
      }

      // При статусе 409 (ветка сдвинулась параллельным коммитом) повторяем со свежим SHA
      if (result.status === 409 && attempt < maxRetries) {
        const waitMs = attempt * 1200;
        console.warn(`[GithubSync] Ветка обновилась другим коммитом (статус 409). Повтор ${attempt}/${maxRetries} через ${waitMs}мс...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      return result;
    }

    return { success: false, error: 'Достигнут лимит попыток синхронизации' };
  }

  /**
   * Одиночная попытка отправки PUT запроса к GitHub API
   */
  private async performSingleCommit(
    filePath: string,
    content: string,
    commitMessage: string
  ): Promise<SyncResult> {
    const cleanPath = filePath.replace(/^\/+/, '');
    const sha = await this.getFileSha(cleanPath);
    const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');
    const finalMessage = commitMessage.includes('[skip ci]')
      ? commitMessage
      : `${commitMessage} [skip ci]`;

    const url = `https://api.github.com/repos/${this.repo}/contents/${cleanPath}`;
    const payload: {
      message: string;
      content: string;
      branch: string;
      sha?: string;
    } = {
      message: finalMessage,
      content: contentBase64,
      branch: this.branch,
    };

    if (sha) {
      payload.sha = sha;
    }

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'LighterHedger-CloudWorker',
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 200 || res.status === 201) {
        const data = (await res.json()) as { commit?: { sha?: string } };
        const commitSha = data.commit?.sha;
        console.log(`[GithubSync] ✅ Файл ${cleanPath} синхронизирован с GitHub (commit: ${commitSha?.slice(0, 7)})`);
        return { success: true, commitSha, status: res.status };
      }

      const errText = await res.text();
      console.error(`[GithubSync] ❌ Ошибка коммита ${cleanPath} (статус ${res.status}): ${errText}`);
      return { success: false, status: res.status, error: errText };
    } catch (err: any) {
      console.error(`[GithubSync] ❌ Сетевая ошибка при коммите ${cleanPath}:`, err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Быстрая синхронизация pnl_and_points_analysis.csv
   */
  public async syncCsvFile(csvContent: string, message: string = 'sync: log trade row'): Promise<SyncResult> {
    return this.syncFile('pnl_and_points_analysis.csv', csvContent, message);
  }

  /**
   * Быстрая синхронизация config.json
   */
  public async syncConfigFile(configContent: string, message: string = 'sync: update config.json'): Promise<SyncResult> {
    return this.syncFile('config.json', configContent, message);
  }
}

export const githubSyncService = new GithubSyncService();
