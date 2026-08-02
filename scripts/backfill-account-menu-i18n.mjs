#!/usr/bin/env node
/**
 * Backfill PR #687 account-menu i18n keys in partial locales.
 * Run from repo root: node scripts/backfill-account-menu-i18n.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '../packages/core/src/i18n/locales');

const PARTIAL_LOCALES = [
  'ar-SA',
  'ca-ES',
  'de-DE',
  'fr-FR',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-PT',
  'zh-CN',
];

const ACCOUNT_MENU_KEYS = {
  'ar-SA': {
    greeting: 'مرحبًا، {{name}}!',
    switchAccount: 'تبديل الحساب',
    storage: {
      title: 'تخزين Oxy',
      usage: '{{used}} من {{total}} مستخدم',
      used: 'مستخدم',
      free: 'متاح',
      unavailable: 'تفاصيل الاستخدام غير متاحة',
      upgrade: 'ترقية الخطة',
      manage: 'إدارة التخزين',
    },
    data: 'بياناتك في Oxy',
    settings: 'إعدادات Oxy',
    help: 'المساعدة والملاحظات',
    signOut: 'تسجيل الخروج',
    privacy: 'سياسة الخصوصية',
    terms: 'شروط الخدمة',
  },
  'ca-ES': {
    greeting: 'Hola, {{name}}!',
    switchAccount: 'Canviar de compte',
    storage: {
      title: 'Emmagatzematge d\'Oxy',
      usage: '{{used}} de {{total}} en ús',
      used: 'En ús',
      free: 'Lliure',
      unavailable: 'Detalls d\'ús no disponibles',
      upgrade: 'Millorar el pla',
      manage: 'Gestionar l\'emmagatzematge',
    },
    data: 'Les teves dades a Oxy',
    settings: 'Configuració d\'Oxy',
    help: 'Ajuda i comentaris',
    signOut: 'Tancar sessió',
    privacy: 'Política de privacitat',
    terms: 'Condicions del servei',
  },
  'de-DE': {
    greeting: 'Hallo, {{name}}!',
    switchAccount: 'Konto wechseln',
    storage: {
      title: 'Oxy-Speicher',
      usage: '{{used}} von {{total}} belegt',
      used: 'Belegt',
      free: 'Frei',
      unavailable: 'Nutzungsdetails nicht verfügbar',
      upgrade: 'Plan upgraden',
      manage: 'Speicher verwalten',
    },
    data: 'Deine Daten bei Oxy',
    settings: 'Oxy-Einstellungen',
    help: 'Hilfe & Feedback',
    signOut: 'Abmelden',
    privacy: 'Datenschutzerklärung',
    terms: 'Nutzungsbedingungen',
  },
  'fr-FR': {
    greeting: 'Bonjour, {{name}} !',
    switchAccount: 'Changer de compte',
    storage: {
      title: 'Stockage Oxy',
      usage: '{{used}} sur {{total}} utilisés',
      used: 'Utilisé',
      free: 'Libre',
      unavailable: 'Détails d\'utilisation indisponibles',
      upgrade: 'Améliorer l\'offre',
      manage: 'Gérer le stockage',
    },
    data: 'Vos données dans Oxy',
    settings: 'Paramètres Oxy',
    help: 'Aide et commentaires',
    signOut: 'Se déconnecter',
    privacy: 'Politique de confidentialité',
    terms: 'Conditions d\'utilisation',
  },
  'it-IT': {
    greeting: 'Ciao, {{name}}!',
    switchAccount: 'Cambia account',
    storage: {
      title: 'Archiviazione Oxy',
      usage: '{{used}} di {{total}} utilizzati',
      used: 'Utilizzato',
      free: 'Libero',
      unavailable: 'Dettagli di utilizzo non disponibili',
      upgrade: 'Aggiorna piano',
      manage: 'Gestisci archiviazione',
    },
    data: 'I tuoi dati in Oxy',
    settings: 'Impostazioni Oxy',
    help: 'Aiuto e feedback',
    signOut: 'Esci',
    privacy: 'Informativa sulla privacy',
    terms: 'Termini di servizio',
  },
  'ja-JP': {
    greeting: 'こんにちは、{{name}}さん！',
    switchAccount: 'アカウントを切り替え',
    storage: {
      title: 'Oxyストレージ',
      usage: '{{total}}中{{used}}を使用中',
      used: '使用中',
      free: '空き',
      unavailable: '使用状況を取得できません',
      upgrade: 'プランをアップグレード',
      manage: 'ストレージを管理',
    },
    data: 'Oxyのデータ',
    settings: 'Oxyの設定',
    help: 'ヘルプとフィードバック',
    signOut: 'サインアウト',
    privacy: 'プライバシーポリシー',
    terms: '利用規約',
  },
  'ko-KR': {
    greeting: '안녕하세요, {{name}}님!',
    switchAccount: '계정 전환',
    storage: {
      title: 'Oxy 저장소',
      usage: '{{total}} 중 {{used}} 사용',
      used: '사용됨',
      free: '여유',
      unavailable: '사용량 정보를 사용할 수 없음',
      upgrade: '플랜 업그레이드',
      manage: '저장소 관리',
    },
    data: 'Oxy의 데이터',
    settings: 'Oxy 설정',
    help: '도움말 및 피드백',
    signOut: '로그아웃',
    privacy: '개인정보 처리방침',
    terms: '서비스 약관',
  },
  'pt-PT': {
    greeting: 'Olá, {{name}}!',
    switchAccount: 'Mudar de conta',
    storage: {
      title: 'Armazenamento Oxy',
      usage: '{{used}} de {{total}} em uso',
      used: 'Em uso',
      free: 'Livre',
      unavailable: 'Detalhes de utilização indisponíveis',
      upgrade: 'Atualizar plano',
      manage: 'Gerir armazenamento',
    },
    data: 'Os seus dados no Oxy',
    settings: 'Definições do Oxy',
    help: 'Ajuda e feedback',
    signOut: 'Terminar sessão',
    privacy: 'Política de privacidade',
    terms: 'Termos de serviço',
  },
  'zh-CN': {
    greeting: '你好，{{name}}！',
    switchAccount: '切换账号',
    storage: {
      title: 'Oxy 存储',
      usage: '已使用 {{used}} / {{total}}',
      used: '已用',
      free: '可用',
      unavailable: '无法获取用量详情',
      upgrade: '升级方案',
      manage: '管理存储',
    },
    data: '你在 Oxy 中的数据',
    settings: 'Oxy 设置',
    help: '帮助与反馈',
    signOut: '退出登录',
    privacy: '隐私政策',
    terms: '服务条款',
  },
};

const MANAGE_ON_DEVICE = {
  'ar-SA': 'إدارة الحسابات على هذا الجهاز',
  'ca-ES': 'Gestionar comptes en aquest dispositiu',
  'de-DE': 'Konten auf diesem Gerät verwalten',
  'fr-FR': 'Gérer les comptes sur cet appareil',
  'it-IT': 'Gestisci account su questo dispositivo',
  'ja-JP': 'このデバイスのアカウントを管理',
  'ko-KR': '이 기기의 계정 관리',
  'pt-PT': 'Gerir contas neste dispositivo',
  'zh-CN': '管理此设备上的账号',
};

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

for (const locale of PARTIAL_LOCALES) {
  const filePath = path.join(localesDir, `${locale}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  data.accountMenu = deepMerge(data.accountMenu ?? {}, ACCOUNT_MENU_KEYS[locale]);

  if (data.accountSwitcher) {
    data.accountSwitcher.manageOnDevice = MANAGE_ON_DEVICE[locale];
  }

  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Updated ${locale}`);
}
