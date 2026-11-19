plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.prumoambiental.planta"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.prumoambiental.planta"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    // Chave de desenvolvimento (fixa, para o celular aceitar atualizações sem desinstalar).
    // Antes de vender o app, criar uma chave própria e privada.
    signingConfigs {
        create("dev") {
            storeFile = file("prumo-dev.jks")
            storePassword = "prumoplanta"
            keyAlias = "prumo"
            keyPassword = "prumoplanta"
        }
    }

    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("dev") }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("dev")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.google.ar:core:1.44.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.core:core-ktx:1.13.1")
}
