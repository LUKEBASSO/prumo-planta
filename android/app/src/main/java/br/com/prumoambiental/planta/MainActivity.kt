package br.com.prumoambiental.planta

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.speech.RecognizerIntent
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import com.google.ar.core.ArCoreApk
import org.json.JSONObject
import java.io.File

/**
 * Tela principal: as telas do Prumo Planta (croqui, contorno, planta) rodam num WebView
 * com os arquivos embutidos no APK (funciona offline). O AR, salvar arquivos, PDF,
 * voz e fotos usam recursos nativos através da ponte "PrumoAndroid".
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var tiles: TileStore
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var fileParams: WebChromeClient.FileChooserParams? = null
    private var cameraUri: Uri? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null

    private val arLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val json = if (r.resultCode == RESULT_OK) r.data?.getStringExtra("json") else null
        js("window.__arResult && window.__arResult(" + JSONObject.quote(json ?: "null") + ")")
    }

    private val vozLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val t = if (r.resultCode == RESULT_OK)
            r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
        js("window.__voz && window.__voz(" + JSONObject.quote(t ?: "") + ")")
    }

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        var res: Array<Uri>? = null
        if (r.resultCode == RESULT_OK) {
            val d = r.data?.data
            res = if (d != null) arrayOf(d) else cameraUri?.let { arrayOf(it) }
        }
        fileCallback?.onReceiveValue(res)
        fileCallback = null
    }

    private val geoPermLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { m ->
        val ok = m[Manifest.permission.ACCESS_FINE_LOCATION] == true || m[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        geoCallback?.invoke(geoOrigin, ok, false)
        geoCallback = null
    }

    private val camPermLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
        abrirSeletorDeArquivo()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tiles = TileStore(this)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/tiles/", tiles)
            .build()

        web = WebView(this)
        setContentView(web)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (temPermissao(Manifest.permission.ACCESS_FINE_LOCATION) || temPermissao(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    callback.invoke(origin, true, false)
                } else {
                    geoOrigin = origin
                    geoCallback = callback
                    geoPermLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                fileParams = params
                if (querImagem(params) && !temPermissao(Manifest.permission.CAMERA)) {
                    camPermLauncher.launch(Manifest.permission.CAMERA)
                } else {
                    abrirSeletorDeArquivo()
                }
                return true
            }
        }

        web.addJavascriptInterface(Ponte(), "PrumoAndroid")
        WebView.setWebContentsDebuggingEnabled(true)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Deixa a tela web fechar janelas abertas; se não houver nada aberto, sai do app.
                web.evaluateJavascript("(window.__voltar && window.__voltar()) ? 1 : 0") { r ->
                    if (r != "1") { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }

    private fun temPermissao(p: String) =
        ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun querImagem(p: WebChromeClient.FileChooserParams?): Boolean =
        p?.acceptTypes?.any { it.contains("image") } == true

    private fun abrirSeletorDeArquivo() {
        val params = fileParams
        val imagem = querImagem(params)
        val pegar = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (imagem) "image/*" else "*/*"
        }
        val extras = mutableListOf<Intent>()
        cameraUri = null
        if (imagem && temPermissao(Manifest.permission.CAMERA)) {
            try {
                val dir = File(cacheDir, "fotos").apply { mkdirs() }
                val f = File(dir, "foto_${System.currentTimeMillis()}.jpg")
                val uri = FileProvider.getUriForFile(this, "$packageName.fotos", f)
                cameraUri = uri
                extras += Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            } catch (_: Exception) { }
        }
        val chooser = Intent.createChooser(pegar, if (imagem) "Foto do cômodo" else "Abrir arquivo")
        if (extras.isNotEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
        try {
            fileLauncher.launch(chooser)
        } catch (_: ActivityNotFoundException) {
            fileCallback?.onReceiveValue(null); fileCallback = null
        }
    }

    /** Salva um arquivo de texto em Downloads/PrumoPlanta. */
    private fun salvar(nome: String, conteudo: String, mime: String): String {
        val bytes = conteudo.toByteArray(Charsets.UTF_8)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val cv = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, nome)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PrumoPlanta")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
                ?: throw IllegalStateException("não foi possível criar o arquivo")
            contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            return "Downloads/PrumoPlanta/$nome"
        } else {
            val dir = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "PrumoPlanta").apply { mkdirs() }
            File(dir, nome).writeBytes(bytes)
            return dir.absolutePath + "/" + nome
        }
    }

    inner class Ponte {
        @JavascriptInterface
        fun arDisponivel(): Boolean = try {
            ArCoreApk.getInstance().checkAvailability(this@MainActivity) != ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE
        } catch (_: Exception) { false }

        @JavascriptInterface
        fun startAr(modo: String) = runOnUiThread {
            arLauncher.launch(Intent(this@MainActivity, ArActivity::class.java).putExtra("modo", modo))
        }

        @JavascriptInterface
        fun saveFile(nome: String, conteudo: String, mime: String) = runOnUiThread {
            try {
                val onde = salvar(nome, conteudo, mime)
                Toast.makeText(this@MainActivity, "Salvo em $onde", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Não consegui salvar: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        @JavascriptInterface
        fun print(nome: String) = runOnUiThread {
            val pm = getSystemService(PRINT_SERVICE) as PrintManager
            val attrs = PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape())
                .build()
            pm.print(nome, web.createPrintDocumentAdapter(nome), attrs)
        }

        @JavascriptInterface
        fun baixarArea(fonte: String, sul: Double, oeste: Double, norte: Double, leste: Double, zMin: Int, zMax: Int) {
            tiles.baixarArea(fonte, sul, oeste, norte, leste, zMin, zMax) { f, t, e, fim ->
                js("window.__tilesProg && window.__tilesProg($f,$t,$e,$fim)")
            }
        }

        @JavascriptInterface
        fun cancelarDownload() = tiles.cancelar()

        @JavascriptInterface
        fun infoTiles(): String = tiles.info()

        @JavascriptInterface
        fun apagarTiles() = tiles.apagar()

        @JavascriptInterface
        fun ouvir() = runOnUiThread {
            val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale as medidas")
            }
            try { vozLauncher.launch(i) } catch (_: ActivityNotFoundException) {
                Toast.makeText(this@MainActivity, "Ditado por voz indisponível neste aparelho.", Toast.LENGTH_LONG).show()
            }
        }
    }
}
