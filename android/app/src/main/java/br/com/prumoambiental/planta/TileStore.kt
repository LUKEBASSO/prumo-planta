package br.com.prumoambiental.planta

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.tan

/**
 * Cache de imagens de satélite no aparelho.
 * Toda imagem que o mapa pede passa por aqui: se já estiver salva, sai do celular (funciona offline);
 * se não, baixa da internet e guarda. "baixarArea" pré-carrega uma região para uso sem sinal.
 */
class TileStore(private val ctx: Context) : WebViewAssetLoader.PathHandler {

    private val raiz get() = File(ctx.filesDir, "tiles")
    private val cancelar = AtomicBoolean(false)
    @Volatile var baixando = false
        private set

    private fun url(fonte: String, z: Int, x: Int, y: Int): String? = when (fonte) {
        "g" -> "https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=$x&y=$y&z=$z"
        "h" -> "https://mt${(x + y) % 4}.google.com/vt/lyrs=y&x=$x&y=$y&z=$z"
        "e" -> "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/$z/$y/$x"
        "c" -> "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/$z/$y/$x"
        else -> null
    }

    private fun arquivo(fonte: String, z: Int, x: Int, y: Int) = File(raiz, "$fonte/$z/$x/$y.jpg")

    private fun baixar(u: String): ByteArray? = try {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 12000
        c.setRequestProperty("User-Agent", "PrumoPlanta/1.0 (Android)")
        try {
            if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null
        } finally { c.disconnect() }
    } catch (_: Exception) { null }

    /** Garante a imagem no cache; devolve os bytes (ou null se não existir e não der para baixar). */
    private fun obter(fonte: String, z: Int, x: Int, y: Int): ByteArray? {
        val f = arquivo(fonte, z, x, y)
        if (f.exists() && f.length() > 0) return try { f.readBytes() } catch (_: Exception) { null }
        val u = url(fonte, z, x, y) ?: return null
        val b = baixar(u) ?: return null
        try {
            f.parentFile?.mkdirs()
            val tmp = File(f.path + ".tmp"); tmp.writeBytes(b); tmp.renameTo(f)
        } catch (_: Exception) { }
        return b
    }

    /** Chamado pelo WebView para caminhos /tiles/{fonte}/{z}/{x}/{y} (roda fora da thread principal). */
    override fun handle(path: String): WebResourceResponse? {
        val p = path.trim('/').split('/')
        if (p.size != 4) return null
        val z = p[1].toIntOrNull() ?: return null
        val x = p[2].toIntOrNull() ?: return null
        val y = p[3].substringBefore('.').toIntOrNull() ?: return null
        val b = obter(p[0], z, x, y) ?: return null
        return WebResourceResponse("image/jpeg", null, ByteArrayInputStream(b)).apply {
            responseHeaders = mapOf("Cache-Control" to "max-age=86400")
        }
    }

    fun info(): String {
        var n = 0; var bytes = 0L
        raiz.walkTopDown().forEach { if (it.isFile && it.name.endsWith(".jpg")) { n++; bytes += it.length() } }
        return "{\"n\":$n,\"mb\":${"%.1f".format(java.util.Locale.US, bytes / 1048576.0)}}"
    }

    fun apagar() { cancelar.set(true); raiz.deleteRecursively() }

    fun cancelar() = cancelar.set(true)

    /** Baixa todas as imagens da área (graus) entre os zooms indicados. progresso(feitos, total, erros, fim). */
    fun baixarArea(
        fonte: String, sul: Double, oeste: Double, norte: Double, leste: Double, zMin: Int, zMax: Int,
        progresso: (Int, Int, Int, Boolean) -> Unit
    ) {
        if (baixando) return
        baixando = true
        cancelar.set(false)
        Thread {
            val lista = ArrayList<IntArray>()
            for (z in zMin..zMax) {
                val x0 = tx(oeste, z); val x1 = tx(leste, z)
                val y0 = ty(norte, z); val y1 = ty(sul, z)
                for (x in x0..x1) for (y in y0..y1) lista.add(intArrayOf(z, x, y))
            }
            val total = lista.size
            val feitos = AtomicInteger(0); val erros = AtomicInteger(0)
            val pool = Executors.newFixedThreadPool(6)
            var ultimo = 0L
            for (t in lista) {
                pool.execute {
                    if (!cancelar.get()) {
                        if (obter(fonte, t[0], t[1], t[2]) == null) erros.incrementAndGet()
                    }
                    val f = feitos.incrementAndGet()
                    val agora = System.currentTimeMillis()
                    if (agora - ultimo > 400) { ultimo = agora; progresso(f, total, erros.get(), false) }
                }
            }
            pool.shutdown()
            pool.awaitTermination(6, TimeUnit.HOURS)
            baixando = false
            progresso(feitos.get(), total, erros.get(), true)
        }.start()
    }

    private fun tx(lng: Double, z: Int) = floor((lng + 180.0) / 360.0 * (1 shl z)).toInt()
    private fun ty(lat: Double, z: Int): Int {
        val r = lat * PI / 180.0
        return floor((1.0 - ln(tan(r) + 1.0 / cos(r)) / PI) / 2.0 * (1 shl z)).toInt()
    }
}
