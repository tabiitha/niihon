// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// Texts of `apps/web/src/shell/locales`.
public enum ShellText: String, TextKey {
    case documentTitle
    case skipToContent
    case navigationLabel
    case accountNavigationLabel
    case navHome
    case navLearning
    case navKanji
    case navLibrary
    case navProfile
    case navAdmin
    case loading
    case unavailableTitle
    case unavailableBody
    case incompatibleTitle
    case incompatibleBody
    case incompatibleVersions
    case errorTitle
    case errorBody
    case errorReference
    case retry
    case notFoundTitle
    case notFoundBody
    case backHome

    public static let source = "apps/web/src/shell/locales"

    public static let table: [Language: [ShellText: String]] = [
        .en: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "Skip to content",
            .navigationLabel: "Main navigation",
            .accountNavigationLabel: "Account",
            .navHome: "Home",
            .navLearning: "Learn",
            .navKanji: "Kanji",
            .navLibrary: "Library",
            .navProfile: "Profile",
            .navAdmin: "Administration",
            .loading: "Connecting to the Nihon service…",
            .unavailableTitle: "The Nihon service is not responding",
            .unavailableBody: "Check that Nihon is running on this computer, then try again.",
            .incompatibleTitle: "This page needs an update",
            .incompatibleBody: "This page was built for another version of the Nihon service. Reload the page; if the message remains, update Nihon.",
            .incompatibleVersions: "Service API version {serverVersion}; this page expects version {clientVersion}.",
            .errorTitle: "Something went wrong",
            .errorBody: "The Nihon service could not complete the request.",
            .errorReference: "Reference for the service log: {requestId}",
            .retry: "Try again",
            .notFoundTitle: "Page not found",
            .notFoundBody: "No page of Nihon has this address.",
            .backHome: "Back to home",
        ],
        .fr: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "Aller au contenu",
            .navigationLabel: "Navigation principale",
            .accountNavigationLabel: "Compte",
            .navHome: "Accueil",
            .navLearning: "Apprendre",
            .navKanji: "Kanji",
            .navLibrary: "Bibliothèque",
            .navProfile: "Profil",
            .navAdmin: "Administration",
            .loading: "Connexion au service Nihon…",
            .unavailableTitle: "Le service Nihon ne répond pas",
            .unavailableBody: "Vérifiez que Nihon fonctionne sur cet ordinateur, puis réessayez.",
            .incompatibleTitle: "Cette page doit être mise à jour",
            .incompatibleBody: "Cette page a été construite pour une autre version du service Nihon. Rechargez la page ; si le message persiste, mettez Nihon à jour.",
            .incompatibleVersions: "Version de l’API du service : {serverVersion} ; cette page attend la version {clientVersion}.",
            .errorTitle: "Une erreur est survenue",
            .errorBody: "Le service Nihon n’a pas pu traiter la demande.",
            .errorReference: "Référence pour le journal du service : {requestId}",
            .retry: "Réessayer",
            .notFoundTitle: "Page introuvable",
            .notFoundBody: "Aucune page de Nihon ne correspond à cette adresse.",
            .backHome: "Retour à l’accueil",
        ],
        .ja: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "本文へ移動",
            .navigationLabel: "メインナビゲーション",
            .accountNavigationLabel: "アカウント",
            .navHome: "ホーム",
            .navLearning: "学習",
            .navKanji: "漢字",
            .navLibrary: "ライブラリ",
            .navProfile: "プロフィール",
            .navAdmin: "管理",
            .loading: "Nihon サービスに接続しています…",
            .unavailableTitle: "Nihon サービスが応答しません",
            .unavailableBody: "このコンピューターで Nihon が起動していることを確認して、もう一度お試しください。",
            .incompatibleTitle: "このページの更新が必要です",
            .incompatibleBody: "このページは別のバージョンの Nihon サービス向けに作られています。ページを再読み込みしてください。表示が消えない場合は Nihon を更新してください。",
            .incompatibleVersions: "サービスの API バージョンは {serverVersion}、このページが必要とするバージョンは {clientVersion} です。",
            .errorTitle: "問題が発生しました",
            .errorBody: "Nihon サービスはリクエストを完了できませんでした。",
            .errorReference: "サービスログの参照番号：{requestId}",
            .retry: "再試行",
            .notFoundTitle: "ページが見つかりません",
            .notFoundBody: "このアドレスの Nihon ページはありません。",
            .backHome: "ホームに戻る",
        ],
    ]
}

/// Texts of `apps/macos/Sources/NihonMacCore/Shell/locales`.
public enum MacShellText: String, TextKey {
    case incompatibleTitle
    case incompatibleBody
    case incompatibleVersions
    case serviceAddress
    case addressTitle
    case addressBody
    case goMenu
    case retryConnection

    public static let source = "apps/macos/Sources/NihonMacCore/Shell/locales"

    public static let table: [Language: [MacShellText: String]] = [
        .en: [
            .incompatibleTitle: "Nihon needs an update",
            .incompatibleBody: "This app was built for another version of the Nihon service. Update the app or the service so that their versions match, then try again.",
            .incompatibleVersions: "Service API version {serverVersion}; this app expects version {clientVersion}.",
            .serviceAddress: "Service address: {address}",
            .addressTitle: "The service address is not allowed",
            .addressBody: "Nihon only connects to a service on this computer. Remove the NihonServiceURL setting or give it a loopback address such as http://127.0.0.1:4000.",
            .goMenu: "Go",
            .retryConnection: "Retry Connection",
        ],
        .fr: [
            .incompatibleTitle: "Nihon doit être mis à jour",
            .incompatibleBody: "Cette application a été construite pour une autre version du service Nihon. Mettez à jour l’application ou le service pour que leurs versions correspondent, puis réessayez.",
            .incompatibleVersions: "Version de l’API du service : {serverVersion} ; cette application attend la version {clientVersion}.",
            .serviceAddress: "Adresse du service : {address}",
            .addressTitle: "L’adresse du service n’est pas autorisée",
            .addressBody: "Nihon se connecte uniquement à un service de cet ordinateur. Supprimez le réglage NihonServiceURL ou donnez-lui une adresse de bouclage comme http://127.0.0.1:4000.",
            .goMenu: "Aller",
            .retryConnection: "Réessayer la connexion",
        ],
        .ja: [
            .incompatibleTitle: "Nihon の更新が必要です",
            .incompatibleBody: "このアプリは別のバージョンの Nihon サービス向けに作られています。アプリまたはサービスを更新してバージョンを合わせてから、もう一度お試しください。",
            .incompatibleVersions: "サービスの API バージョンは {serverVersion}、このアプリが必要とするバージョンは {clientVersion} です。",
            .serviceAddress: "サービスのアドレス：{address}",
            .addressTitle: "このサービスのアドレスは使用できません",
            .addressBody: "Nihon はこのコンピューター上のサービスにのみ接続します。NihonServiceURL の設定を削除するか、http://127.0.0.1:4000 のようなループバックアドレスを指定してください。",
            .goMenu: "移動",
            .retryConnection: "接続を再試行",
        ],
    ]
}

/// Texts of `apps/web/src/modules/home/locales`.
public enum HomeText: String, TextKey {
    case title
    case eyebrow
    case practiceTitle
    case practiceBody
    case startReview
    case discoverKana

    public static let source = "apps/web/src/modules/home/locales"

    public static let table: [Language: [HomeText: String]] = [
        .en: [
            .title: "Home",
            .eyebrow: "Your practice",
            .practiceTitle: "Kana review",
            .practiceBody: "Your due reviews and progress will appear here once kana learning is available.",
            .startReview: "Start review",
            .discoverKana: "Discover new kana",
        ],
        .fr: [
            .title: "Accueil",
            .eyebrow: "Votre entraînement",
            .practiceTitle: "Révision des kana",
            .practiceBody: "Vos révisions à faire et votre progression apparaîtront ici dès que l’apprentissage des kana sera disponible.",
            .startReview: "Commencer la révision",
            .discoverKana: "Découvrir de nouveaux kana",
        ],
        .ja: [
            .title: "ホーム",
            .eyebrow: "あなたの練習",
            .practiceTitle: "かなの復習",
            .practiceBody: "かなの学習が利用できるようになると、復習予定と進捗がここに表示されます。",
            .startReview: "復習を始める",
            .discoverKana: "新しいかなを覚える",
        ],
    ]
}

/// Texts of `apps/web/src/modules/learning/locales`.
public enum LearningText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/learning/locales"

    public static let table: [Language: [LearningText: String]] = [
        .en: [
            .title: "Learn",
            .body: "Kana lessons, reviews, and custom practice will appear here.",
        ],
        .fr: [
            .title: "Apprendre",
            .body: "Les leçons de kana, les révisions et l’entraînement personnalisé apparaîtront ici.",
        ],
        .ja: [
            .title: "学習",
            .body: "かなのレッスン、復習、カスタム練習がここに表示されます。",
        ],
    ]
}

/// Texts of `apps/web/src/modules/kanji/locales`.
public enum KanjiText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/kanji/locales"

    public static let table: [Language: [KanjiText: String]] = [
        .en: [
            .title: "Kanji",
            .body: "The kanji explorer and dictionary will appear here.",
        ],
        .fr: [
            .title: "Kanji",
            .body: "L’explorateur de kanji et le dictionnaire apparaîtront ici.",
        ],
        .ja: [
            .title: "漢字",
            .body: "漢字エクスプローラーと辞書がここに表示されます。",
        ],
    ]
}

/// Texts of `apps/web/src/modules/library/locales`.
public enum LibraryText: String, TextKey {
    case title
    case body
    case readerTitle
    case readerMedia
    case readerPending
    case readerMissing
    case backToLibrary

    public static let source = "apps/web/src/modules/library/locales"

    public static let table: [Language: [LibraryText: String]] = [
        .en: [
            .title: "Library",
            .body: "Your media and collections will appear here.",
            .readerTitle: "Reader",
            .readerMedia: "Media {mediaId}",
            .readerPending: "The player for this media arrives with the media features.",
            .readerMissing: "No media is selected. Open a media item from the library.",
            .backToLibrary: "Back to the library",
        ],
        .fr: [
            .title: "Bibliothèque",
            .body: "Vos médias et vos collections apparaîtront ici.",
            .readerTitle: "Lecteur",
            .readerMedia: "Média {mediaId}",
            .readerPending: "Le lecteur de ce média arrivera avec les fonctionnalités médias.",
            .readerMissing: "Aucun média n’est sélectionné. Ouvrez un média depuis la bibliothèque.",
            .backToLibrary: "Retour à la bibliothèque",
        ],
        .ja: [
            .title: "ライブラリ",
            .body: "メディアとコレクションがここに表示されます。",
            .readerTitle: "プレーヤー",
            .readerMedia: "メディア {mediaId}",
            .readerPending: "このメディアのプレーヤーはメディア機能とともに提供されます。",
            .readerMissing: "メディアが選択されていません。ライブラリからメディアを開いてください。",
            .backToLibrary: "ライブラリに戻る",
        ],
    ]
}

/// Texts of `apps/web/src/modules/profile/locales`.
public enum ProfileText: String, TextKey {
    case title
    case body
    case displayTitle
    case displayNote
    case language
    case style
    case mode
    case modeSystem
    case modeLight
    case modeDark

    public static let source = "apps/web/src/modules/profile/locales"

    public static let table: [Language: [ProfileText: String]] = [
        .en: [
            .title: "Profile",
            .body: "Your profile and account settings will appear here.",
            .displayTitle: "Display",
            .displayNote: "These choices apply to this page until profile preferences are available.",
            .language: "Language",
            .style: "Style",
            .mode: "Mode",
            .modeSystem: "System",
            .modeLight: "Light",
            .modeDark: "Dark",
        ],
        .fr: [
            .title: "Profil",
            .body: "Votre profil et les réglages de votre compte apparaîtront ici.",
            .displayTitle: "Affichage",
            .displayNote: "Ces choix s’appliquent à cette page jusqu’à l’arrivée des préférences du profil.",
            .language: "Langue",
            .style: "Style",
            .mode: "Mode",
            .modeSystem: "Système",
            .modeLight: "Clair",
            .modeDark: "Sombre",
        ],
        .ja: [
            .title: "プロフィール",
            .body: "プロフィールとアカウント設定がここに表示されます。",
            .displayTitle: "表示",
            .displayNote: "プロフィールの設定が利用できるようになるまで、これらの選択はこのページにのみ適用されます。",
            .language: "言語",
            .style: "スタイル",
            .mode: "モード",
            .modeSystem: "システム",
            .modeLight: "ライト",
            .modeDark: "ダーク",
        ],
    ]
}

/// Texts of `apps/web/src/modules/admin/locales`.
public enum AdminText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/admin/locales"

    public static let table: [Language: [AdminText: String]] = [
        .en: [
            .title: "Administration",
            .body: "Administration tools will appear here for administrators.",
        ],
        .fr: [
            .title: "Administration",
            .body: "Les outils d’administration apparaîtront ici pour les administrateurs.",
        ],
        .ja: [
            .title: "管理",
            .body: "管理者向けの管理ツールがここに表示されます。",
        ],
    ]
}
