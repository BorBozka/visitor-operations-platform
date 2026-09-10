# Kurumsal Ziyaretçi ve Operasyon Yönetim Sistemi

BPLAS A.Ş. için geliştirdiğim çok şirketli ve çok tesisli yapılarda ziyaret planlama, giriş-çıkış operasyonları, kaynak
atama ve yönetici raporlamasını ortak bir çalışma alanında birleştiren rol tabanlı web
uygulaması.

![Admin dashboard; aktif ziyaretler, durum dağılımı ve günlük operasyon görünümü](visitor-operations-dashboard.jpg)

## Güncel durum

Projenin geliştirme ve teknik audit süreci tamamlandı. Uygulama development/test MSSQL ortamında doğrulandı; production deployment bu proje kapsamında gerçekleştirilmedi.

Frontend yalnız Fastify/Prisma/MSSQL backend'ine HTTP adaptörleri üzerinden bağlanır; backend
erişilemezse in-memory servislere sessiz fallback yapmaz. Backend LOCAL kimlik doğrulama,
server-side rol/kapsam
yetkilendirmesi, hashed opaque session ve invitation tokenları ile environment tabanlı log/SMTP
e-posta teslim sınırını içerir. Active Directory entegrasyonu uygulama kapsamında değildir.

## Problem ve ürün yaklaşımı

Kurumsal ziyaret süreçleri; çalışan, yönetici, güvenlik ve admin kullanıcılarının farklı
ihtiyaçları nedeniyle yalnızca bir kayıt formundan ibaret değildir. Planlama, giriş-çıkış takibi,
ziyaretçi kartları, kaynak kullanımı, operasyonel gecikmeler ve dönemsel raporlama aynı ürün
içinde fakat rol bazlı yetkilerle ele alınır.

Uygulama; çalışanların ziyaret planlayabildiği, yöneticilerin şirket genelindeki operasyonları
izleyebildiği, güvenliğin fiziksel giriş-çıkış sürecini yürütebildiği ve adminlerin sistem
yapılandırmasını yönetebildiği modüler bir yapıya sahiptir.

## Rolüm ve katkılarım

- Kurum ihtiyaçlarını ve paydaş beklentilerini ürün kapsamına dönüştürdüm.
- Kullanıcı rollerini, yetki sınırlarını ve temel iş akışlarını belirledim.
- Ziyaret planlama, zaman çizelgesi, toplantı yaşam döngüsü, kaynak atama ve raporlama
  özelliklerini kapsamlandırdım.
- Bilgi hiyerarşisi, kullanıcı akışları ve arayüz davranışları hakkında ürün ve UI/UX kararları
  aldım.
- İşleri aşamalara ayırarak görevleri AI ajanlarına tanımladım.
- Üretilen çıktıları işlevsel ve görsel gereksinimlere göre değerlendirdim; düzeltme ve
  iyileştirmeleri PR tabanlı bir süreçle yönlendirdim.

## Ürün kapsamı

- Ziyaret oluşturma, düzenleme, yeniden planlama ve iptal akışları
- Gün, hafta ve ay görünümleriyle ziyaret zaman çizelgesi
- Ziyaret detayları ve Meeting yaşam döngüsü
- Şirket ve tesis bağlamına göre filtreleme ve server-side kapsam kontrolü
- Yönetici ve admin dashboard'ları
- Güvenlik giriş-çıkış, plansız ziyaret ve ziyaretçi kartı operasyonları
- Kaynak, kullanıcı ve organizasyon yönetimi
- Mal hareketleri ve araç/şoför planlama
- Filtrelenebilir raporlar ile CSV, Excel ve PDF çıktıları

## Kullanıcı rolleri

| Rol | Temel sorumluluk |
| --- | --- |
| Çalışan | Kendi ziyaretlerini planlama, düzenleme, erteleme ve iptal etme |
| Yönetici | Yetkili olduğu şirket/tesis kapsamındaki ziyaretleri, kaynakları ve raporları yönetme |
| Güvenlik | Yetkili kapı kapsamında plansız ziyaret, kart ve giriş-çıkış operasyonları |
| Admin | Kullanıcı, organizasyon, kaynak ve sistem yapılandırmasını yönetme |

## Teknolojiler

### Frontend

- React 19, TypeScript ve Vite
- Tailwind CSS ve shadcn/ui
- React Hook Form ve Zod
- date-fns ve Recharts
- write-excel-file, jsPDF/jspdf-autotable, html2canvas ve CSV export

### Backend ve veritabanı

- Node.js, TypeScript ve Fastify
- Prisma ORM 6.19.3 ve Microsoft SQL Server
- Argon2id
- HttpOnly cookie üzerinden opaque server-side sessions
- Nodemailer ile log/SMTP teslim sınırı

### Test ve kalite

- Vitest frontend/backend suite'leri
- Gerçek MSSQL integration testleri
- Playwright E2E
- ESLint, TypeScript ve Prisma doğrulamaları

## Yerel kurulum

Gereksinimler: desteklenen bir Node.js sürümü, pnpm ve erişilebilir Microsoft SQL Server.

1. **MSSQL'i hazırlayın.** SQL Server instance'ını çalıştırın ve boş bir
   `visitor_operations` veritabanı oluşturun.
2. **Bağımlılıkları kurun.** Repository kökünde:

       pnpm install --frozen-lockfile

3. **Environment dosyalarını hazırlayın.** Kök `.env.example` dosyasını `.env.local`,
   `server/.env.example` dosyasını `server/.env` olarak kopyalayın. `server/.env` içindeki
   `DATABASE_URL` değerini kendi SQL Server bağlantınıza göre ayarlayın. Development/test seed çalıştırmak
   için yalnız yerel ortamda `NODE_ENV=development` ve `DEMO_SEED_ENABLED=true` kullanın.
4. **Prisma Client ve development migration'larını uygulayın.** Development ortamında:

       pnpm db:generate
       pnpm db:migrate

5. **Development/test verisini seed edin.** Yalnız bilerek etkinleştirilmiş development/test veritabanında:

       pnpm db:seed

6. **Backend'i başlatın.** Development watcher:

       pnpm dev:api

   API varsayılan olarak `http://localhost:3001`; readiness endpoint'i
   `http://localhost:3001/api/ready` adresindedir.
7. **Frontend'i başlatın.** Ayrı terminalde:

       pnpm dev

   Frontend varsayılan olarak `http://localhost:5173` adresindedir.

### Environment özeti

- Frontend runtime her zaman gerçek Fastify/MSSQL uygulamasını kullanır.
- Kök `VITE_API_BASE_URL`, `/api` dahil backend taban adresidir. Tanımlanmazsa frontend
  `http://localhost:3001/api` kullanır.
- `WEB_ORIGIN`, backend CORS ve public invitation URL üretimi için tek frontend origin'idir.
- `DATABASE_URL`, Prisma SQL Server bağlantısıdır.
- `SESSION_COOKIE_NAME` ve `SESSION_TTL_HOURS`, server-side session cookie adını ve ömrünü
  belirler. Cookie production'da `Secure` olur.
- Development/test ortamında `EMAIL_DELIVERY_MODE=log` e-posta göndermez. Production'da
  `EMAIL_DELIVERY_MODE=smtp` zorunludur ve tüm SMTP alanları sağlanmadıkça server başlamaz.
- `DEMO_SEED_ENABLED` production'da `false` kalmalıdır.
- Kök `VITE_DEMO_LOGIN=true`, login ekranında dört demo rolünü (Admin, Yönetici, Çalışan,
  Güvenlik) tek tıkla forma dolduran kompakt butonları gösterir. Butonlar yalnız kullanıcı adı ve
  şifre alanlarını doldurur; giriş yine normal `Giriş Yap` ve LOCAL `/api/auth/login` akışıyla
  yapılır. Flag tanımsız/`true` dışında bir değer olduğunda butonlar hiç render edilmez ve
  production build'de varsayılan kapalıdır. İlgili hesaplar yalnız development seed'inde
  (`NODE_ENV=development` + `DEMO_SEED_ENABLED=true`) oluşturulur; credential'lar
  `server/prisma/seed-data.ts` ve `src/config/demo-login.ts` sözleşmesinde tutulur.

## Development ve production komutları

Development migration'ı schema değişikliği üretmek/uygulamak için yalnız development'ta kullanın:

    pnpm db:migrate              # prisma migrate dev

Staging/production mevcut migration geçmişini uygular; yeni migration üretmez:

    pnpm db:migrate:deploy       # prisma migrate deploy

Temiz bir production veritabanını sıfırdan kullanılabilir hale getirmenin desteklenen sırası:

    pnpm install --frozen-lockfile
    pnpm db:generate
    pnpm db:migrate:deploy
    pnpm db:bootstrap              # yalnız bir kez; aşağıya bakın
    pnpm build:all
    pnpm start:api

`pnpm build` yalnız frontend'in mevcut build davranışını korur. `pnpm build:api` backend'i
`server/dist/` altına derler; `pnpm start:api` bu çıktıyı Node.js ile çalıştırır. Frontend
`dist/` dizini ayrıca statik bir web sunucusu/CDN üzerinden servis edilmelidir.

Bootstrap adımından sonra ilk Admin normal `Giriş Yap` ekranından LOCAL kimlik doğrulamasıyla
oturum açar; kalan organizasyon ve uygulama yapılandırması (ek tesisler, departmanlar, güvenlik
kapıları, ziyaret türleri, ziyaretçi kartları, operasyon parametreleri, diğer kullanıcılar ve
aktif ziyaretçi kuralı) Admin UI/API üzerinden yapılır.

### Production bootstrap (`pnpm db:bootstrap`)

Temiz bir veritabanında henüz giriş yapılabilecek bir Admin yoktur ve root Company API üzerinden
oluşturulamaz (yeni şirket oluşturmak her Admin'in yetki kapsamının dışındadır). Bu tek seferlik
komut o boşluğu kapatır ve **minimum administrative root** dışında hiçbir şey oluşturmaz:

- ilk **Company**
- o şirket altında bir **Facility**
- ilk **ADMIN** kullanıcı (LOCAL, aktif, Argon2id ile hash'lenmiş parola)
- Admin'in **şirket düzeyi yetki kapsamı** — tesis/güvenlik kapısı ataması yoktur; bu, mevcut
  yetkilendirme modelinin ifade edebildiği en geniş kapsamdır (boş tesis/kapı listesi, kapsanan
  şirket içinde "sınırsız" anlamına gelir). Yetkilendirmeyi atlayan özel bir bootstrap rolü
  oluşturulmaz.

Ziyaretçi kuralı bilinçli olarak yayımlanmaz: aktif kural yokken ilgili akış `409 NO_ACTIVE_RULE`
döner ve kuralı yayımlamak Admin'in bilinçli iş akışının parçasıdır.

Komut şu şekilde çalıştırılır (kök karşılığı `pnpm db:bootstrap`):

    pnpm --filter @visitor-management/api db:bootstrap

Gerekli girdiler yalnız environment üzerinden verilir; hiçbirinin varsayılanı yoktur ve komut
eksik girdiyle çalışmaz (fail-closed):

| Değişken | Açıklama |
| --- | --- |
| `BOOTSTRAP_ENABLED` | Kazara çalıştırmaya karşı açık onay; `true` olmalıdır. |
| `BOOTSTRAP_COMPANY_NAME` | İlk şirketin adı. |
| `BOOTSTRAP_FACILITY_NAME` | O şirket altındaki ilk tesisin adı. |
| `BOOTSTRAP_ADMIN_USERNAME` | İlk Admin'in kullanıcı adı. |
| `BOOTSTRAP_ADMIN_FULL_NAME` | İlk Admin'in ad soyadı. |
| `BOOTSTRAP_ADMIN_EMAIL` | İlk Admin'in e-posta adresi. |
| `BOOTSTRAP_ADMIN_PASSWORD` | En az sekiz karakter (uygulamanın LOCAL hesap politikası). |

Parolayı secret manager/CI secret üzerinden geçici olarak sağlayın; komut satırına positional
argüman olarak vermeyin ve dosyaya yazmayın. Parola yalnız Argon2id hash'i olarak saklanır; düz
metin hâli log'a, hata mesajına veya veritabanına yazılmaz. Bootstrap tamamlandıktan sonra
`BOOTSTRAP_*` değişkenlerini ortamdan kaldırın.

Güvenlik davranışı:

- **Temiz veritabanı** (hiç Company ve hiç User yok): Company + Facility + ADMIN + kapsam tek bir
  `Serializable` transaction içinde oluşturulur. Yarım kalmış bir kök (Admin'siz şirket, kapsamsız
  Admin) commit edilemez.
- **Aynı bootstrap tekrar çalıştırılırsa**: beklenen kök birebir mevcutsa hiçbir yazma yapılmaz,
  parola sessizce döndürülmez ve komut "zaten bootstrap edilmiş" sonucuyla çıkar.
- **Belirsiz/başka veri içeren veritabanı** (başka şirket, başka Admin, beklenen kökün olmaması,
  organizasyon kaydı olup Admin olmaması gibi): komut hiçbir şey yazmadan hata ile çıkar. Bu
  durumda doğru kararı operatör verir; bootstrap mevcut organizasyon grafiğine veri enjekte etmez.

Bootstrap yalnız bu komutla çalışır: `pnpm db:seed` onu çağırmaz, server başlangıcı ve API onu
otomatik tetiklemez.

Production'da development/test seed'i çalıştırmayın. Demo seed guard'ı `NODE_ENV=development` ve
`DEMO_SEED_ENABLED=true` koşullarını birlikte ister; production verisine karşı etkinleştirmeyin.
Demo seed ile production bootstrap tamamen ayrıdır: demo seed development hesapları, zayıf demo
parolaları ve development reference verisi oluşturur; bootstrap bunların hiçbirini oluşturmaz.

## Production topology notu

Session cookie mevcut güvenlik sözleşmesinde HttpOnly ve `SameSite=lax` kullanır. Bu nedenle
frontend ile backend'in aynı site altında (örneğin aynı registrable domain'in alt domainleri veya
reverse-proxy yolları) konuşlandırılması tercih edilir. Farklı cross-site domainler kullanılacaksa
cookie ve CORS politikası ayrıca güvenlik değerlendirmesinden geçirilmelidir. Bu repository'deki
varsayılanlar cross-site deployment için gevşetilmemiştir.

Reverse proxy kullanılan deployment'ta `TRUST_PROXY` ayarlanmalıdır. Bu ayar client IP
çözümlemesini belirler; per-IP login rate limit'i ve public ziyaretçi kuralı kabul kayıtlarındaki
IP alanı aynı çözümlenmiş IP'yi kullanır.

- API doğrudan internete/istemciye açıksa `TRUST_PROXY` kapalı kalmalıdır (tanımsız, boş veya
  `false`). Bu varsayılanda client IP socket peer adresidir ve forwarding header'ları dikkate
  alınmaz.
- Reverse proxy varsa yalnız gerçekten güvenilen proxy adreslerini listeleyin: virgülle ayrılmış
  IP, CIDR veya `loopback`/`linklocal`/`uniquelocal` değerleri (örneğin
  `TRUST_PROXY=127.0.0.1,::1` ya da proxy'nin gerçek subnet'i).
- Bütün proxy'lere körü körüne güvenmeyin; `TRUST_PROXY=true` bilinçli olarak reddedilir. Geçersiz
  bir değer de permissive bir varsayılana düşmez, server başlamadan yapılandırma hatası verir.
- Ayar kapalıyken proxy arkasında bütün kullanıcılar tek proxy IP'si olarak görülür: login rate
  limit tek bucket'a düşer ve audit kayıtları gerçek client IP'sini içermez.

## Backend e-posta teslimi

Geliştirme/test için güvenli varsayılan:

    EMAIL_DELIVERY_MODE=log

Bu mod e-posta göndermez; alıcı/konu metadatasını loglar fakat e-posta gövdesini, invitation
tokenını veya pre-registration URL'sini loglamaz. Production'da `EMAIL_DELIVERY_MODE=smtp`
zorunludur. SMTP için
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_ADDRESS` ve
`MAIL_FROM_NAME` değerlerinin tamamını environment üzerinden sağlayın. Secret ve gerçek SMTP
credential'ları commit edilmez.

## Doğrulama komutları

    pnpm typecheck
    pnpm typecheck:api
    pnpm lint
    pnpm test
    pnpm test:api
    pnpm --filter @visitor-management/api test:mssql   # RUN_MSSQL_INTEGRATION=true + MSSQL env
    pnpm e2e                                           # backend + frontend preview + MSSQL + seed
    pnpm build
    pnpm build:api
    pnpm --filter @visitor-management/api exec prisma validate
    pnpm --filter @visitor-management/api exec prisma migrate status

## Proje dokümantasyonu

- [Ürün kapsamı ve davranışları](docs/PRODUCT_SPEC.md)
- [Arayüz ilkeleri](docs/UI_SPEC.md)
- [Teknoloji yığını](docs/TECH_STACK.md)
- [Final geliştirme özeti](docs/DEVELOPMENT_PLAN.md)
- [API sözleşmesi](docs/API.md)
- [Paydaş notları](docs/STAKEHOLDER_NOTES.md)

## Kapsam notları

- Ziyaretçi kartları fiziksel numaralı kartlardır; erişim-kontrol donanımıyla entegre değildir.
- Gecikme ayrı bir ziyaret statüsü değil, mevcut zaman ve planlanan çıkıştan hesaplanan bir
  göstergedir.
- Mal hareketleri ve araç planlama, ziyaret yaşam döngüsünden ayrı operasyon modülleridir.
- Public cloud backend/MSSQL deployment, Docker, CI/CD ve IIS/Nginx/reverse-proxy altyapısı bu
  proje kapsamına dahil değildir.
