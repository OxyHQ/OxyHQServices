import React, { useCallback, useEffect, useMemo, type ErrorInfo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { useTheme } from '@oxyhq/bloom/theme';
import type { SurfaceControls } from '@oxyhq/bloom/surfaces';
import type { RouteName } from '../navigation/routes';
import { getScreenComponent } from '../navigation/routes';
import type { SurfaceNavStack } from '../navigation/surfaceNavStack';
import type { SurfacePresentation } from '../navigation/surfaceRegistry';
import {
  closeAllRouteSurfaces,
  navigateWithinOrPresent,
  presentRoute,
  replaceWithinOrPresent,
} from '../navigation/surfaces';
import type { BaseScreenProps } from '../types/navigation';

/** Error boundary catching screen render failures (e.g. a lazy `require()` throw). */
interface ScreenErrorBoundaryState {
  error: Error | null;
}

class ScreenErrorBoundary extends React.Component<
  { screenName: string; children: React.ReactNode },
  ScreenErrorBoundaryState
> {
  state: ScreenErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (__DEV__) {
      console.error(
        `[SurfaceScreen] Screen "${this.props.screenName}" crashed:`,
        error,
        info.componentStack,
      );
    }
  }

  componentDidUpdate(prevProps: { screenName: string }): void {
    if (prevProps.screenName !== this.props.screenName && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          {__DEV__ && <Text style={errorStyles.message}>{this.state.error.message}</Text>}
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  message: { fontSize: 13, textAlign: 'center' },
});

export interface SurfaceScreenProps {
  /** This surface's route history (the NAV-WITHIN axis). */
  navStack: SurfaceNavStack;
  /** Bloom's per-surface controls (dismiss / present a child) — the DEPTH axis. */
  surface: SurfaceControls;
  /** This surface's presentation, so `navigate` knows when to drill in vs. stack. */
  presentation: SurfacePresentation;
}

/**
 * Binds one SDK surface to its content: resolves the lazy screen for the current
 * nav-stack frame and renders it inside the error boundary with the per-surface
 * navigation props. Mounted by `surfaces.present` as the Bloom surface's content.
 *
 * Dismissal is driven through the nav stack's `closing` flag (watched in an
 * effect) rather than a captured-controls call, so a dismiss requested before
 * this surface mounted still resolves the Bloom surface exactly once.
 */
function SurfaceScreen({ navStack, surface, presentation }: SurfaceScreenProps) {
  const theme = useTheme();
  const state = useStore(navStack.store);
  const top = state.frames[state.frames.length - 1];

  useEffect(() => {
    if (state.closing) surface.dismiss(state.closeResult);
  }, [state.closing, state.closeResult, surface]);

  const ScreenComponent = useMemo(() => getScreenComponent(top.route) ?? null, [top.route]);

  const navigate = useCallback(
    (route: RouteName, props?: Record<string, unknown>) =>
      navigateWithinOrPresent(presentation, navStack, route, props),
    [navStack, presentation],
  );

  const replace = useCallback(
    (route: RouteName, props?: Record<string, unknown>) =>
      replaceWithinOrPresent(presentation, navStack, route, props),
    [navStack, presentation],
  );

  const dismiss = useCallback((result?: unknown) => navStack.requestDismiss(result), [navStack]);

  const canGoBack = useCallback(() => navStack.canGoBack(), [navStack]);

  const setStep = useCallback((step: number) => navStack.setStep(step), [navStack]);

  // Screen-facing back: pop a frame, else step a wizard back, else dismiss the
  // surface — the exact behaviour the single `BottomSheetRouter` had per session.
  const goBack = useCallback((): void => {
    if (navStack.goBack()) return;
    const current = navStack.getTop();
    if (current.step > 0) {
      navStack.setStep(current.step - 1);
      return;
    }
    navStack.requestDismiss();
  }, [navStack]);

  const present = useCallback(
    (route: RouteName, props?: Record<string, unknown>) => presentRoute(route, props).result,
    [],
  );

  const screenProps = useMemo<BaseScreenProps>(() => {
    const { initialStep: _omitInitialStep, ...rest } = top.props;
    return {
      // NAV-WITHIN
      navigate,
      goBack,
      replace,
      canGoBack,
      initialStep: top.step,
      step: top.step,
      onStepChange: setStep,
      setStep,
      currentScreen: top.route,
      // DEPTH — `onClose`/`onAuthenticated` unwind the whole session (matching the
      // old `closeBottomSheet`); `dismiss`/`present` are the per-surface controls.
      onClose: closeAllRouteSurfaces,
      onAuthenticated: closeAllRouteSurfaces,
      dismiss,
      present,
      // Theme + the route's own props.
      theme: theme.mode,
      ...rest,
    };
  }, [navigate, goBack, replace, canGoBack, setStep, present, dismiss, theme.mode, top.route, top.step, top.props]);

  if (!ScreenComponent) return null;

  return (
    <ScreenErrorBoundary screenName={top.route}>
      <ScreenComponent {...screenProps} />
    </ScreenErrorBoundary>
  );
}

export default SurfaceScreen;
