import type { LocaleDict } from '../types';

/**
 * Spanish (es-ES) translation dictionary for the auth web app.
 *
 * Tone: informal "tú" — matches the rest of the Oxy ecosystem.
 */
const es: LocaleDict = {
  common: {
    cancel: 'Cancelar',
    save: 'Guardar',
    continue: 'Continuar',
    back: 'Atrás',
    signOut: 'Cerrar sesión',
    delete: 'Eliminar',
    loading: 'Cargando…',
    error: 'Error',
    success: 'Listo',
  },

  app: {
    name: 'Oxy',
    title: 'Inicia sesión · Oxy',
  },

  language: {
    picker: {
      label: 'Idioma',
      ariaLabel: 'Elegir idioma',
    },
  },

  footer: {
    terms: 'Términos',
    privacy: 'Privacidad',
    help: 'Ayuda',
    copyright: '© {{year}} Oxy',
  },

  settings: {
    title: 'Ajustes de la cuenta',
    sections: {
      password: 'Contraseña',
      sessions: 'Sesiones',
      linkedAccounts: 'Cuentas vinculadas',
      language: 'Idioma',
    },
    password: {
      title: 'Cambiar contraseña',
      currentLabel: 'Contraseña actual',
      newLabel: 'Nueva contraseña',
      confirmLabel: 'Confirma la nueva contraseña',
      submit: 'Cambiar contraseña',
      success: 'Contraseña cambiada.',
      error: 'No se pudo cambiar la contraseña.',
    },
    sessions: {
      title: 'Sesiones activas',
      subtitle: 'Dispositivos con sesión iniciada en tu cuenta.',
      currentBadge: 'Este dispositivo',
      revoke: 'Cerrar sesión',
      revokeAll: 'Cerrar sesión en los demás dispositivos',
      revokedToast: 'Sesión cerrada.',
      empty: 'No hay otras sesiones activas.',
    },
    linkedAccounts: {
      title: 'Cuentas vinculadas',
      subtitle: 'Proveedores externos conectados a tu cuenta de Oxy.',
      link: 'Vincular',
      unlink: 'Desvincular',
      none: 'No hay cuentas vinculadas.',
    },
  },

  fedcm: {
    status: {
      signedInAs: 'Sesión iniciada como {{name}}',
      signedOut: 'Sesión cerrada',
    },
  },
};

export default es;
