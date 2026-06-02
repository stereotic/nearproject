# Инструкция по деплою NEAR Marketplace на VPS

## 1. Подготовка VPS

### Системные требования
- **ОС**: Ubuntu 20.04 / 22.04 / 24.04 (рекомендуется)
- **RAM**: от 512 MB
- **Node.js**: v18+ (рекомендуется v20 LTS)

### Подключение к серверу через SSH

```bash
# Замените user на ваш логин, ip_address — на IP вашего сервера
ssh root@ip_address
```

Если вы используете нестандартный порт:
```bash
ssh -p 2222 root@ip_address
```

---

## 2. Установка Node.js

```bash
# Обновление пакетов
apt update && apt upgrade -y

# Установка Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Проверка версии
node -v
npm -v
```

---

## 3. Установка Git (если нужен для загрузки)

```bash
apt install -y git
```

---

## 4. Загрузка проекта на сервер

### Вариант A: Через Git (если проект в репозитории)

```bash
git clone https://github.com/ваш-username/ваш-репозиторий.git /var/www/near
cd /var/www/near
```

### Вариант B: Через SCP (с локальной машины)

На вашем локальном компьютере (Windows — PowerShell):

```powershell
# Архивируем проект (без node_modules и .vs)
Compress-Archive -Path "C:\Users\Артем\Desktop\projects\NEAR\*" -DestinationPath "C:\temp\near.zip" -Exclude @("node_modules", ".vs", "*.db")

# Копируем на сервер
scp C:\temp\near.zip root@ip_address:/root/near.zip
```

На сервере:
```bash
# Распаковываем
mkdir -p /var/www/near
unzip /root/near.zip -d /var/www/near
cd /var/www/near
```

### Вариант C: Через rsync (на локальной машине)

```bash
# На локальной машине (Linux/Mac) или через WSL
rsync -avz --exclude 'node_modules' --exclude '.vs' --exclude '*.db' -e ssh /путь/к/NEAR/ root@ip_address:/var/www/near/
```

---

## 5. Установка зависимостей

```bash
cd /var/www/near
npm install
```

---

## 6. Создание systemd-сервиса (автозапуск)

Создайте файл сервиса:

```bash
nano /etc/systemd/system/near.service
```

Вставьте содержимое:

```ini
[Unit]
Description=NEAR Marketplace
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/near
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=PORT=3000
Environment=ADMIN_SECRET=ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТНЫЙ_КЛЮЧ

[Install]
WantedBy=multi-user.target
```

**Важно**: замените `ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТНЫЙ_КЛЮЧ` на ваш секретный ключ (32 символа).

Примените сервис:

```bash
systemctl daemon-reload
systemctl enable near
systemctl start near
systemctl status near
```

---

## 7. Настройка Nginx (прокси + SSL)

### Установка Nginx

```bash
apt install -y nginx
```

### Создание конфигурации

```bash
nano /etc/nginx/sites-available/near
```

```nginx
server {
    listen 80;
    server_name ваш-домен.com или IP_адрес;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Увеличиваем таймауты для больших файлов
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /uploads/ {
        alias /var/www/near/uploads/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

Включите сайт:

```bash
ln -s /etc/nginx/sites-available/near /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default  # удалить дефолтную страницу
nginx -t
systemctl reload nginx
```

---

## 8. Настройка SSL (HTTPS) через Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.com
```

Следуйте инструкциям. Certbot автоматически обновит конфигурацию Nginx.

Проверка автообновления:
```bash
certbot renew --dry-run
```

---

## 9. Файрвол (UFW)

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

---

## 10. Мониторинг и логи

### Просмотр логов приложения
```bash
journalctl -u near -f
```

### Логи Nginx
```bash
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Перезапуск сервисов
```bash
systemctl restart near      # перезапуск приложения
systemctl reload nginx      # перезагрузка Nginx
```

---

## 11. Обновление сайта

```bash
cd /var/www/near

# Остановка сервиса
systemctl stop near

# Обновление файлов (через git pull или scp)
# ...

# Переустановка зависимостей (если package.json изменился)
npm install

# Запуск
systemctl start near
```

---

## 12. Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `PORT` | Порт сервера | `3000` |
| `ADMIN_SECRET` | Секретный ключ админа (32 символа) | `9f7c2e8b4a61d3f5c8e2a9b7d4f1c6e0` |

**Настоятельно рекомендуется** сменить `ADMIN_SECRET` на уникальный!

---

## 13. Структура проекта на сервере

```
/var/www/near/
├── server.js          # основной сервер
├── package.json
├── node_modules/      # зависимости
├── public/            # статические файлы (HTML, CSS, JS)
├── uploads/           # загруженные изображения
├── near.db            # SQLite база данных (создается автоматически)
├── cleanup.js         # скрипт очистки
└── DEPLOY.md          # эта инструкция
```

---

## 14. Быстрая проверка

```bash
# Проверка, что сервис запущен
curl http://127.0.0.1:3000
# Должен вернуть HTML главной страницы

# Проверка API (если ADMIN_SECRET = test123)
curl -H "x-admin-key: test123" http://127.0.0.1:3000/api/admin/stats

# Проверка через домен
curl https://ваш-домен.com
```

---

## Готово!

Сайт доступен по адресу:
- **HTTP**: `http://ваш-домен.com` или `http://IP_адрес`
- **HTTPS**: `https://ваш-домен.com`
- **Админка**: `https://ваш-домен.com/adm`
