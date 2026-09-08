# Kurumsal Ziyaretçi ve Operasyon Yönetim Sistemi

Çok şirketli ve çok tesisli yapılarda ziyaret planlama, giriş-çıkış operasyonları, kaynak
atama ve yönetici raporlamasını ortak bir çalışma alanında birleştiren rol tabanlı web
uygulaması.

![Admin dashboard; aktif ziyaretler, durum dağılımı ve günlük operasyon görünümü](visitor-operations-dashboard.jpg)

## Güncel durum

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
- XLSX/xlsx-js-style, jsPDF/jspdf-autotable, html2canvas ve CSV export

### Backend ve veritabanı

- Node.js, TypeScript ve Fastify
- Prisma ORM 6.15 ve Microsoft SQL Server
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
- `EMAIL_DELIVERY_MODE=log` e-posta göndermez. `smtp` modu tüm SMTP alanlarını zorunlu kılar.
- `DEMO_SEED_ENABLED` production'da `false` kalmalıdır.

## Development ve production komutları

Development migration'ı schema değişikliği üretmek/uygulamak için yalnız development'ta kullanın:

    pnpm db:migrate              # prisma migrate dev

Staging/production mevcut migration geçmişini uygular; yeni migration üretmez:

    pnpm db:migrate:deploy       # prisma migrate deploy

Production artifact'larını oluşturup derlenmiş backend'i çalıştırmak için:

    pnpm install --frozen-lockfile
    pnpm db:generate
    pnpm db:migrate:deploy
    pnpm build:all
    pnpm start:api

`pnpm build` yalnız frontend'in mevcut build davranışını korur. `pnpm build:api` backend'i
`server/dist/` altına derler; `pnpm start:api` bu çıktıyı Node.js ile çalıştırır. Frontend
`dist/` dizini ayrıca statik bir web sunucusu/CDN üzerinden servis edilmelidir.

Production seed önerilmez. Development/test seed guard'ı `NODE_ENV=development` ve
`DEMO_SEED_ENABLED=true` koşullarını birlikte ister; production verisine karşı etkinleştirmeyin.

## Production topology notu

Session cookie mevcut güvenlik sözleşmesinde HttpOnly ve `SameSite=lax` kullanır. Bu nedenle
frontend ile backend'in aynı site altında (örneğin aynı registrable domain'in alt domainleri veya
reverse-proxy yolları) konuşlandırılması tercih edilir. Farklı cross-site domainler kullanılacaksa
cookie ve CORS politikası ayrıca güvenlik değerlendirmesinden geçirilmelidir. Bu repository'deki
varsayılanlar cross-site deployment için gevşetilmemiştir.

## Backend e-posta teslimi

Geliştirme için güvenli varsayılan:

    EMAIL_DELIVERY_MODE=log

Bu mod e-posta göndermez; alıcı/konu metadatasını loglar fakat e-posta gövdesini, invitation
tokenını veya pre-registration URL'sini loglamaz. SMTP için `EMAIL_DELIVERY_MODE=smtp` seçin ve
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
  repository cleanup kapsamına dahil değildir.
