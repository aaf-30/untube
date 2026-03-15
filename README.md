# untube

*(Project ini merupakan adaptasi dan porting logika dekripsi dari [yt-dlp](https://github.com/yt-dlp/yt-dlp))*

## Fitur

- ✅ Mendapatkan metadata video lengkap.
- ✅ Mendukung HTTP/HTTPS Proxy via `undici`.
- ✅ Pengelolaan Cookies otomatis.
- ✅ Full TypeScript support.

## Instalasi

```bash
npm install untube
```

## Penggunaan

```typescript
import { getVideoInfo } from 'untube';

async function main() {
    try {
        const info = await getVideoInfo('videoId', {
            // Opsional: Path ke file cookies (format Netscape)
            cookieFile: './cookies.txt',
            // Opsional: Gunakan proxy jika terkena rate limit/blokir
            proxy: 'http://user:pass@my-proxy.com:8080'
        });

        console.log('Judul:', info.title);
        console.log('Channel:', info.uploader);
        
        // List format video & audio yang tersedia
        info.formats.forEach(format => {
            console.log(`[${format.format_id}] ${format.resolution} - ${format.url}`);
        });
    } catch (error) {
        console.error('Gagal mengambil info:', error);
    }
}

main();
```

## Penanganan Cookies

Penggunaan cookies sangat disarankan untuk menghindari rate limit, mengakses video yang dibatasi umur (NSFW), atau video yang hanya tersedia di wilayah tertentu.

### Cara Mendapatkan Cookies:
1. Instal ekstensi browser seperti **"Get cookies.txt LOCALLY"** (tersedia di Chrome Web Store atau Firefox Add-ons).
2. Buka YouTube dan pastikan Anda sudah login (opsional, tapi disarankan).
3. Klik pada ekstensi tersebut dan pilih **"Export as Netscape format"**.
4. Simpan file tersebut dengan nama `cookies.txt` di direktori proyek Anda.
5. Masukkan path file tersebut ke dalam opsi `cookieFile` saat memanggil `getVideoInfo`.

> **⚠️ Keamanan:** Jangan pernah membagikan file `cookies.txt` Anda kepada siapapun karena berisi sesi login Anda. Pastikan `cookies.txt` sudah masuk ke dalam `.gitignore`.

## Lisensi

[Unlicense](LICENSE)

