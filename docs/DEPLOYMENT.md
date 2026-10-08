# Размещение на Vercel с Neon Free

Этот документ описывает настройку публичного демо из [репозитория «Смена»](https://github.com/naimaaan/smena-driver-diary). Фактический адрес появится после успешного развёртывания в вашем аккаунте Vercel.

На Vercel интерфейс Vite отдаётся как статика, API работает через `api/serverless.ts`, поездки сохраняются в Neon Postgres. Для API переменная `DATABASE_URL` обязательна: при ошибке начального подключения он возвращает JSON с кодом `503`, без переключения на временную SQLite-базу. Локальный сервер использует Postgres при заданном `DATABASE_URL`, иначе SQLite; Docker Compose по умолчанию использует SQLite в volume.

Файловая система Vercel Functions временная и не является общей постоянной базой между экземплярами функции. Поэтому для добавленных поездок используется внешняя база. [Объяснение Vercel про SQLite](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).

## 1. Импортировать репозиторий

1. Войдите в Vercel и выберите **Add New → Project**.
2. Подключите GitHub и импортируйте `naimaaan/smena-driver-diary`.
3. Оставьте корневой каталог репозитория как **Root Directory**.
4. Проверьте настройки сборки:

| Настройка | Значение |
|---|---|
| Framework Preset | `Vite` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist/client` |
| Node.js Version | `22.x` |

[`vercel.json`](../vercel.json) задаёт сборку, каталог результата, включение `data/trips.json` в функцию и перенаправление `/api/:path*` в `/api/serverless`. Используйте его настройки; запускать `npm start` на Vercel не нужно. Node 22 закреплён в `package.json`. Платформа поддерживает Vite и Node.js 22; версию Node можно проверить в **Settings → Build and Deployment**. [Vite на Vercel](https://vercel.com/docs/frameworks/frontend/vite), [версии Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Если база Neon уже создана, добавьте `DATABASE_URL` до первого Deploy. Если ещё нет — создайте проект Vercel, подключите базу по следующему разделу и выполните Redeploy.

## 2. Подключить Neon Free

Neon предлагает план **Free**, подходящий для этой демонстрации. Выберите его при создании ресурса. [Официальное сообщение Neon от 2 октября 2026 года](https://neon.com/blog/neon-free-plan-1-gb-per-project).

### Через Vercel Marketplace / Storage

1. Откройте проект Vercel, затем **Storage** или **Marketplace**.
2. Найдите **Neon**, создайте базу на плане Free и подключите её к проекту.
3. Выберите окружения **Production** и **Preview**.
4. В **Settings → Environment Variables** проверьте наличие переменной с точным именем `DATABASE_URL`.
5. Если интеграция создала URL под другим именем, добавьте `DATABASE_URL` со значением строки подключения Neon.

Vercel подключает внешние Postgres-базы через Marketplace и может добавлять их переменные окружения в проект. [Postgres на Vercel](https://vercel.com/docs/postgres).

### Напрямую через Neon

1. Создайте проект на плане Free в [консоли Neon](https://console.neon.tech).
2. Откройте сведения о подключении и выберите **Pooled connection**.
3. Скопируйте полную строку подключения, включая параметры SSL.
4. В Vercel откройте **Settings → Environment Variables** и добавьте её как `DATABASE_URL` для **Production** и **Preview**.

Используйте готовую pooled-строку из Neon: в её hostname обычно есть `-pooler`. Pooling позволяет повторно использовать соединения в серверных функциях. [Рекомендации Vercel](https://vercel.com/kb/guide/connection-pooling-with-functions), [пояснение Neon про pooled-подключение](https://neon.com/blog/postgres-support-case-recap).

### Переменная подключения

| Поле | Значение |
|---|---|
| Имя | `DATABASE_URL` |
| Значение | Полная pooled-строка подключения из Neon |
| Окружения | `Production`, `Preview` |
| Тип | `Secret`, если доступен выбор типа |

Храните URL в серверной переменной окружения Vercel. Префикс `VITE_` для него не нужен: переменные с этим префиксом предназначены для клиентской сборки. Строку подключения не добавляют в GitHub, исходники интерфейса или скриншоты настроек.

Для Preview можно подключить отдельную базу или ветку Neon, чтобы проверочные поездки не попадали в Production. Область действия переменной должна совпадать с окружением проверяемого деплоя. [Окружения переменных Vercel](https://vercel.com/docs/environment-variables).

## 3. Выполнить Deploy / Redeploy

После подключения базы откройте **Deployments** и выполните **Redeploy** нужной версии. Новые переменные окружения применяются к новому развёртыванию. [Переменные окружения Vercel](https://vercel.com/docs/environment-variables).

При первом обращении API создаёт нужные таблицы и однократно загружает пример из `data/trips.json`. Таблицы, данные и маркер импорта создаются в транзакции под advisory lock, поэтому одновременные холодные старты не запускают два импорта. Маркер хранится в Postgres: последующие старты и деплои не добавляют пример заново и не стирают сохранённые поездки.

Файл локальной SQLite-базы не нужно загружать в репозиторий или на Vercel. Настройки `DATABASE_PATH`, локальные файлы `.sqlite` и Docker volume относятся к локальному запуску; на Vercel постоянные данные находятся в Neon.

Дождитесь состояния **Ready** и откройте URL из Vercel. Полученный URL можно приложить как демо к анкете после проверки ниже.

## 4. Проверить опубликованную версию

Подставьте адрес вашего проекта вместо `https://YOUR-PROJECT.vercel.app`.

1. Откройте `/api/health`: ожидается JSON со статусом `ok`.
2. Откройте `/api/days/2026-10-01`: в новой базе пример даёт `tripCount: 2`, `revenue: 3900`, `commission: 585`, `net: 3315`, `cash: 1500`, `card: 2400`.
3. Откройте `/?date=2026-10-01` и сравните сводку с API. Переключите день и вернитесь обратно.
4. Добавьте проверочную поездку за другой день через форму; после обновления страницы она должна остаться в списке.
5. Проверьте повтор API-запроса с тем же идентификатором.

Пример последней проверки в PowerShell — UUID создаётся один раз и используется в обеих отправках:

```powershell
$demoOrigin = 'https://YOUR-PROJECT.vercel.app'
$demoTrip = @{
  id = [guid]::NewGuid().ToString()
  start = '2026-10-15T10:00:00+05:00'
  end = '2026-10-15T10:25:00+05:00'
  amount = 2000
  payment = 'cash'
  commission = 300
} | ConvertTo-Json -Compress

Invoke-WebRequest -Uri "$demoOrigin/api/trips" -Method Post `
  -ContentType 'application/json' -Body $demoTrip |
  Select-Object StatusCode, Content

Invoke-WebRequest -Uri "$demoOrigin/api/trips" -Method Post `
  -ContentType 'application/json' -Body $demoTrip |
  Select-Object StatusCode, Content
```

Первая отправка нового UUID возвращает `201` и `created: true`, повтор — `200` и `created: false`. В `/api/days/2026-10-15` должна появиться одна запись с этим UUID. Обновите страницу этого дня и повторно проверьте наличие записи. Если вы добавляли поездки за 1 октября, его итог закономерно отличается от исходных 3 315 ₸.

## Если что-то не работает

| Симптом | Что проверить |
|---|---|
| Страница открывается, API возвращает ошибку | `DATABASE_URL` у нужного окружения, подключение Neon и Function Logs в Vercel |
| После добавления переменной ничего не изменилось | Выполнен ли новый Deploy / Redeploy |
| API возвращает HTML или 404 | В деплой попала версия с `vercel.json` и `api/serverless.ts`, корнем выбран весь репозиторий |
| Сборка использует неожиданную версию Node | Настройки проекта и `engines.node` в `package.json`: диапазон версий может переопределять выбор в интерфейсе |

Демо сохраняет текущий объём мини-проекта: один водитель, общие данные и отсутствие авторизации. Настройка базы не добавляет банковских интеграций или реального вывода денег.
