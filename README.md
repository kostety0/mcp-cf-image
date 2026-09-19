# mcp-cf-image — генерация картинок через Cloudflare Workers AI для Claude Code

Один файл `server.js`, без сторонних обёрток. Модели: FLUX.1 Schnell (по умолчанию),
SDXL, SDXL Lightning, DreamShaper. Сохраняет файлы на диск и показывает превью Claude.

## 1. Cloudflare (5 минут, карта не нужна)

1. Зарегистрируйтесь на https://dash.cloudflare.com
2. **Account ID**: в дашборде справа на главной странице аккаунта (или в URL после `/dash.cloudflare.com/`).
3. **API Token**: My Profile → API Tokens → Create Token → Custom token:
   - Permissions: `Account` → `Workers AI` → `Read`
   - Account Resources: ваш аккаунт
   - Create Token → скопируйте (показывается один раз).

## 2. Установка

```
git clone https://github.com/kostety0/mcp-cf-image.git
cd mcp-cf-image
npm install
```

## 3. Проверка ключей (в cmd.exe)

```
set CF_ACCOUNT_ID=ваш_account_id
set CF_API_TOKEN=ваш_token
node test.js
```
Должно появиться `OK: saved test.jpg` и файл рядом со скриптом.

## 4. Подключение к Claude Code (в cmd.exe, не PowerShell)

```
claude mcp add --scope user cf-image --env CF_ACCOUNT_ID=ваш_account_id --env CF_API_TOKEN=ваш_token --env CF_IMAGE_DIR=/путь/к/папке/для/картинок -- node /путь/к/mcp-cf-image/server.js
claude mcp list
```

`CF_IMAGE_DIR` — папка по умолчанию для относительных путей.

## 5. Использование

В сессии `claude`:

> Сгенерируй 4 варианта героя по промпту №1, сохрани как hero/hero.png

Инструмент `generate_image` принимает: `prompt`, `output_path`, `model` (flux | sdxl |
sdxl-lightning | dreamshaper), `seed`, `variations` (1–4), `steps`, а для SDXL ещё
`negative_prompt`, `width`, `height`.

Советы:
- FLUX на Cloudflare не принимает `seed` и negative prompt — единый стиль держится только префиксом; запреты пишите словами в промпт.
- `seed` работает для SDXL-моделей: там можно фиксировать его внутри серии.
- Если нужен negative prompt или нестандартный размер — используйте `model: sdxl`.

## Лимиты

Бесплатный тариф Workers AI — 10 000 «нейронов» в день. FLUX Schnell 1024×1024 при 4 шагах
стоит несколько сотен нейронов, то есть порядка 20–40 картинок в день. Лимит сбрасывается ежесуточно.

## Лицензия

MIT — см. [LICENSE](LICENSE).
