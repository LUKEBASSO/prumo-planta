package br.com.prumoambiental.planta

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.ar.core.Anchor
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.DepthPoint
import com.google.ar.core.HitResult
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Session
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableException
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.hypot
import kotlin.math.sqrt

/**
 * Medição por AR nativo (ARCore).
 * modo "comodos": marca os cantos no piso, vários cômodos na mesma sessão.
 * modo "contorno": marca as quinas externas do prédio (uma volta).
 * modo "trena": mede a distância entre dois pontos (paredes, na altura do peito).
 * Devolve JSON no mesmo formato que a versão web espera.
 */
class ArActivity : ComponentActivity(), GLSurfaceView.Renderer {

    private var modo = "comodos"
    private var session: Session? = null
    private var installRequested = false
    private val bg = BackgroundRenderer()

    private lateinit var surface: GLSurfaceView
    private lateinit var overlay: OverlayView
    private lateinit var msg: TextView

    // Estado usado só na thread de desenho (GL)
    private val atuais = mutableListOf<Anchor>()
    private val fechados = mutableListOf<MutableList<Anchor>>()
    private val acoes = ConcurrentLinkedQueue<String>()
    private var largura = 1
    private var altura = 1
    private var geometriaMudou = true
    private var texturaDefinida = false
    private var ultimaMsg = ""

    private val camPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) { toast("Sem permissão de câmera o AR não funciona."); finish() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        modo = intent.getStringExtra("modo") ?: "comodos"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this)
        surface = GLSurfaceView(this).apply {
            preserveEGLContextOnPause = true
            setEGLContextClientVersion(2)
            setEGLConfigChooser(8, 8, 8, 8, 16, 0)
            setRenderer(this@ArActivity)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        overlay = OverlayView(this)
        root.addView(surface, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(overlay, FrameLayout.LayoutParams(MATCH, MATCH))

        msg = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setBackgroundColor(Color.argb(170, 0, 0, 0))
            gravity = Gravity.CENTER
            setPadding(dp(14), dp(10), dp(14), dp(10))
            text = "Iniciando a câmera…"
        }
        root.addView(msg, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.TOP).apply {
            setMargins(dp(10), dp(30), dp(10), 0)
        })

        val painel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(6), dp(10), dp(16))
        }
        val marcar = botao(if (modo == "trena") "Marcar ponto" else "Marcar canto", Color.rgb(255, 212, 0), Color.BLACK) { acoes.add("marca") }
        painel.addView(marcar, LinearLayout.LayoutParams(MATCH, dp(64)))
        val linha = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        linha.addView(botao("Desfazer") { acoes.add("desfazer") }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(0, dp(6), dp(3), 0) })
        if (modo == "comodos") {
            linha.addView(botao("Fechar cômodo") { acoes.add("fechar") }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(3), dp(6), 0, 0) })
        }
        painel.addView(linha)
        val fimTxt = when (modo) { "trena" -> "Usar esta medida"; "contorno" -> "Concluir contorno"; else -> "Concluir e voltar ao croqui" }
        painel.addView(botao(fimTxt) { acoes.add("fim") }, LinearLayout.LayoutParams(MATCH, dp(52)).apply { setMargins(0, dp(6), 0, 0) })
        painel.addView(botao("Cancelar", Color.argb(150, 0, 0, 0), Color.WHITE) { setResult(RESULT_CANCELED); finish() },
            LinearLayout.LayoutParams(MATCH, dp(44)).apply { setMargins(0, dp(6), 0, 0) })
        root.addView(painel, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM))

        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (session == null) {
            try {
                when (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
                    ArCoreApk.InstallStatus.INSTALL_REQUESTED -> { installRequested = true; return }
                    else -> {}
                }
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    camPerm.launch(Manifest.permission.CAMERA); return
                }
                val s = Session(this)
                val cfg = Config(s).apply {
                    planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
                    focusMode = Config.FocusMode.AUTO
                    updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
                    if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depthMode = Config.DepthMode.AUTOMATIC
                }
                s.configure(cfg)
                session = s
            } catch (e: UnavailableException) {
                toast("AR indisponível neste aparelho: ${e.message ?: e.javaClass.simpleName}")
                finish(); return
            } catch (e: Exception) {
                toast("Erro ao iniciar o AR: ${e.message}")
                finish(); return
            }
        }
        try {
            session?.resume()
        } catch (e: CameraNotAvailableException) {
            toast("A câmera está ocupada por outro app.")
            session = null; finish(); return
        }
        surface.onResume()
    }

    override fun onPause() {
        super.onPause()
        if (::surface.isInitialized) surface.onPause()
        session?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        session?.close()
        session = null
    }

    // ---------------- GL ----------------

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        bg.createOnGlThread()
        texturaDefinida = false
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        GLES20.glViewport(0, 0, w, h)
        largura = w; altura = h; geometriaMudou = true
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val s = session ?: return
        if (!texturaDefinida) { s.setCameraTextureName(bg.textureId); texturaDefinida = true }
        if (geometriaMudou) {
            @Suppress("DEPRECATION")
            val rot = (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
            s.setDisplayGeometry(rot, largura, altura); geometriaMudou = false
        }
        val frame = try { s.update() } catch (e: Exception) { return }
        val cam = frame.camera
        bg.draw(frame)

        val rastreando = cam.trackingState == TrackingState.TRACKING
        val alvo: HitResult? = if (rastreando) escolherAlvo(frame.hitTest(largura / 2f, altura / 2f)) else null

        // ações pedidas pelos botões
        while (true) {
            val a = acoes.poll() ?: break
            when (a) {
                "marca" -> if (alvo == null) {
                    toast(if (modo == "trena") "Mire a parede até o círculo ficar verde." else "Aponte para o chão até o círculo ficar verde.")
                } else {
                    if (modo == "trena" && atuais.size >= 2) { atuais.forEach { it.detach() }; atuais.clear() }
                    try { atuais.add(alvo.createAnchor()) } catch (e: Exception) { toast("Não deu para marcar aqui. Tente de novo.") }
                }
                "desfazer" -> if (atuais.isNotEmpty()) atuais.removeAt(atuais.size - 1).detach()
                    else if (fechados.isNotEmpty()) fechados.removeAt(fechados.size - 1).forEach { it.detach() }
                "fechar" -> if (atuais.size < 3) toast("Marque pelo menos 3 cantos antes de fechar.")
                    else { fechados.add(atuais.toMutableList()); atuais.clear(); toast("Cômodo fechado. Vá para o próximo sem sair do AR.") }
                "fim" -> { finalizar(); return }
            }
        }

        val view = FloatArray(16); val proj = FloatArray(16)
        cam.getViewMatrix(view, 0)
        cam.getProjectionMatrix(proj, 0, 0.05f, 200f)
        val cur = alvo?.hitPose?.let { floatArrayOf(it.tx(), it.ty(), it.tz()) }
        overlay.atualizar(OverlayView.Quadro(
            view, proj, modo,
            fechados.map { pl -> pl.map { pos(it) } },
            atuais.map { pos(it) },
            cur, rastreando
        ))

        val texto = if (!rastreando) motivo(cam.trackingFailureReason) else mensagem(alvo != null)
        if (texto != ultimaMsg) { ultimaMsg = texto; runOnUiThread { msg.text = texto } }
    }

    private fun pos(a: Anchor): FloatArray { val p = a.pose; return floatArrayOf(p.tx(), p.ty(), p.tz()) }

    /** Escolhe o melhor ponto sob a mira: piso/plano reconhecido primeiro, depois profundidade, depois pontos. */
    private fun escolherAlvo(hits: List<HitResult>): HitResult? {
        var plano: HitResult? = null; var prof: HitResult? = null; var ponto: HitResult? = null
        for (h in hits) {
            when (val t = h.trackable) {
                is Plane -> if (plano == null && t.isPoseInPolygon(h.hitPose) &&
                    (modo == "trena" || t.type == Plane.Type.HORIZONTAL_UPWARD_FACING)) plano = h
                is DepthPoint -> if (prof == null) prof = h
                is Point -> if (ponto == null && t.orientationMode == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL) ponto = h
            }
        }
        return plano ?: prof ?: ponto
    }

    private fun mensagem(temAlvo: Boolean): String = when (modo) {
        "trena" -> when {
            atuais.size >= 2 -> "Medida: " + num(dist3(pos(atuais[0]), pos(atuais[1]))) + " m. Toque em “Usar esta medida” ou marque de novo."
            !temAlvo -> "Aponte para a parede e mova o celular devagar até o círculo ficar verde."
            atuais.isEmpty() -> "Mire a parede na altura do peito e toque em “Marcar ponto”."
            else -> "Agora mire a parede oposta, na mesma altura, e marque o segundo ponto."
        }
        "contorno" -> when {
            !temAlvo -> "Aponte para o chão e mova o celular devagar até o círculo ficar verde."
            atuais.isEmpty() -> "Do lado de fora, mire o pé da parede numa quina e marque. Depois dê a volta marcando cada quina."
            else -> "${atuais.size} quina(s). Vá até a próxima quina e marque. Ao fechar a volta, toque em “Concluir contorno”."
        }
        else -> when {
            !temAlvo -> "Aponte para o piso e mova o celular devagar até o círculo ficar verde."
            atuais.isNotEmpty() -> "Cômodo ${fechados.size + 1}: ${atuais.size} canto(s). Aponte para o próximo canto no piso."
            fechados.isNotEmpty() -> "${fechados.size} cômodo(s) medidos. Vá para o próximo cômodo sem sair do AR e marque o primeiro canto."
            else -> "Mire um canto do cômodo no piso e toque em “Marcar canto”. Meça todos os cômodos nesta mesma sessão."
        }
    }

    private fun motivo(r: TrackingFailureReason): String = when (r) {
        TrackingFailureReason.INSUFFICIENT_LIGHT -> "Pouca luz. Acenda as luzes ou abra as janelas."
        TrackingFailureReason.EXCESSIVE_MOTION -> "Movimento rápido demais. Mova o celular mais devagar."
        TrackingFailureReason.INSUFFICIENT_FEATURES -> "Superfície lisa demais. Aponte para algo com detalhes (piso, rodapé, móveis)."
        TrackingFailureReason.CAMERA_UNAVAILABLE -> "Câmera indisponível."
        else -> "Mova o celular devagar para o AR reconhecer o ambiente."
    }

    private fun finalizar() {
        val json: String? = when (modo) {
            "trena" -> if (atuais.size >= 2) String.format(Locale.US, "%.4f", dist3(pos(atuais[0]), pos(atuais[1]))) else null
            "contorno" -> {
                val pl = when { atuais.size >= 3 -> atuais; fechados.isNotEmpty() -> fechados[0]; else -> null }
                pl?.let { poligono(it) }
            }
            else -> {
                val todos = ArrayList<List<Anchor>>(fechados)
                if (atuais.size >= 3) todos.add(atuais)
                if (todos.isEmpty()) null else todos.joinToString(",", "[", "]") { poligono(it) }
            }
        }
        if (json == null) {
            toast(when (modo) { "trena" -> "Marque os dois pontos primeiro."; "contorno" -> "Marque pelo menos 3 quinas."; else -> "Marque pelo menos um cômodo (3 cantos)." })
            return
        }
        runOnUiThread {
            setResult(RESULT_OK, Intent().putExtra("json", json))
            finish()
        }
    }

    /** Polígono no plano do piso: x para a direita, y = -z (mesma convenção da versão web). */
    private fun poligono(pl: List<Anchor>): String =
        pl.joinToString(",", "[", "]") { val p = pos(it); String.format(Locale.US, "[%.4f,%.4f]", p[0], -p[2]) }

    private fun toast(t: String) = runOnUiThread { Toast.makeText(this, t, Toast.LENGTH_SHORT).show() }

    private fun botao(t: String, fundo: Int = Color.argb(235, 255, 255, 255), cor: Int = Color.BLACK, f: () -> Unit) =
        Button(this).apply {
            text = t; isAllCaps = false
            setTextColor(cor); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setBackgroundColor(fundo)
            setOnClickListener { f() }
        }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        fun dist3(a: FloatArray, b: FloatArray) =
            sqrt(((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])).toDouble())
        fun dist2(a: FloatArray, b: FloatArray) = hypot((a[0] - b[0]).toDouble(), (a[2] - b[2]).toDouble())
        fun num(v: Double) = String.format(Locale("pt", "BR"), "%.2f", v)
    }
}

/** Desenha mira, pontos, linhas e medidas por cima da câmera. */
class OverlayView(ctx: Context) : View(ctx) {
    class Quadro(
        val view: FloatArray, val proj: FloatArray, val modo: String,
        val fechados: List<List<FloatArray>>, val atuais: List<FloatArray>,
        val cur: FloatArray?, val rastreando: Boolean
    )

    @Volatile private var q: Quadro? = null
    private val d = resources.displayMetrics.density
    private val linha = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * d; strokeCap = Paint.Cap.ROUND }
    private val tracejado = Paint(linha).apply { pathEffect = DashPathEffect(floatArrayOf(10 * d, 8 * d), 0f) }
    private val cheio = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val texto = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 15 * d; textAlign = Paint.Align.CENTER; isFakeBoldText = true }
    private val numero = Paint(texto).apply { color = Color.BLACK; textSize = 11 * d }
    private val caixa = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(190, 0, 0, 0) }
    private val tmp = FloatArray(4)
    private val clip = FloatArray(4)

    fun atualizar(novo: Quadro) { q = novo; postInvalidate() }

    private fun projetar(p: FloatArray, f: Quadro): FloatArray? {
        Matrix.multiplyMV(tmp, 0, f.view, 0, floatArrayOf(p[0], p[1], p[2], 1f), 0)
        Matrix.multiplyMV(clip, 0, f.proj, 0, tmp, 0)
        if (clip[3] <= 0.01f) return null
        return floatArrayOf((clip[0] / clip[3] + 1f) / 2f * width, (1f - clip[1] / clip[3]) / 2f * height)
    }

    private fun dist(a: FloatArray, b: FloatArray, f: Quadro) =
        if (f.modo == "trena") ArActivity.dist3(a, b) else ArActivity.dist2(a, b)

    private fun seg(c: Canvas, a: FloatArray, b: FloatArray, f: Quadro, cor: Int, rotulo: Boolean, p: Paint = linha) {
        val A = projetar(a, f) ?: return
        val B = projetar(b, f) ?: return
        p.color = cor
        c.drawLine(A[0], A[1], B[0], B[1], p)
        if (rotulo) {
            val t = ArActivity.num(dist(a, b, f)) + " m"
            val mx = (A[0] + B[0]) / 2; val my = (A[1] + B[1]) / 2
            val w = texto.measureText(t) / 2 + 6 * d
            c.drawRoundRect(RectF(mx - w, my - 13 * d, mx + w, my + 9 * d), 6 * d, 6 * d, caixa)
            c.drawText(t, mx, my + 3 * d, texto)
        }
    }

    override fun onDraw(c: Canvas) {
        super.onDraw(c)
        val f = q ?: return
        val amarelo = Color.rgb(255, 212, 0)
        for (pl in f.fechados) for (i in pl.indices) seg(c, pl[i], pl[(i + 1) % pl.size], f, Color.rgb(53, 208, 255), false)
        for (i in 1 until f.atuais.size) seg(c, f.atuais[i - 1], f.atuais[i], f, amarelo, true)
        if (f.modo == "contorno" && f.atuais.size > 2) seg(c, f.atuais.last(), f.atuais[0], f, Color.argb(160, 255, 212, 0), false, tracejado)
        val aberto = !(f.modo == "trena" && f.atuais.size >= 2)
        if (f.cur != null && f.atuais.isNotEmpty() && aberto) seg(c, f.atuais.last(), f.cur, f, Color.WHITE, true, tracejado)
        f.atuais.forEachIndexed { i, p ->
            val s = projetar(p, f) ?: return@forEachIndexed
            cheio.color = amarelo; c.drawCircle(s[0], s[1], 8 * d, cheio)
            if (f.modo == "contorno") c.drawText((i + 1).toString(), s[0], s[1] + 4 * d, numero)
        }
        // mira no centro da tela
        val cx = width / 2f; val cy = height / 2f
        val ok = f.cur != null
        linha.color = if (ok) Color.rgb(60, 220, 120) else Color.argb(200, 255, 80, 80)
        c.drawCircle(cx, cy, 18 * d, linha)
        c.drawLine(cx - 26 * d, cy, cx - 10 * d, cy, linha); c.drawLine(cx + 10 * d, cy, cx + 26 * d, cy, linha)
        c.drawLine(cx, cy - 26 * d, cx, cy - 10 * d, linha); c.drawLine(cx, cy + 10 * d, cx, cy + 26 * d, linha)
        cheio.color = if (ok) Color.rgb(60, 220, 120) else Color.argb(200, 255, 80, 80)
        c.drawCircle(cx, cy, 3 * d, cheio)
    }
}
