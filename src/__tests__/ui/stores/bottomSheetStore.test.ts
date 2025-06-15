import { renderHook, act } from '@testing-library/react-native';
import { useBottomSheetStore } from '../../../ui/stores/bottomSheetStore';

describe('BottomSheetStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useBottomSheetStore.setState({
      contentHeight: 0,
      snapPoints: ['60%', '85%'],
      keyboardVisible: false,
      keyboardHeight: 0,
      isPresented: false,
      currentScreen: 'SignIn',
      screenProps: undefined,
      fadeAnimValue: 0,
      slideAnimValue: 50,
      handleScaleAnimValue: 1,
    });
  });

  it('should initialize with correct default values', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    expect(result.current.contentHeight).toBe(0);
    expect(result.current.snapPoints).toEqual(['60%', '85%']);
    expect(result.current.keyboardVisible).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
    expect(result.current.isPresented).toBe(false);
    expect(result.current.currentScreen).toBe('SignIn');
    expect(result.current.fadeAnimValue).toBe(0);
    expect(result.current.slideAnimValue).toBe(50);
    expect(result.current.handleScaleAnimValue).toBe(1);
  });

  it('should update content height correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    act(() => {
      result.current.setContentHeight(400);
    });

    expect(result.current.contentHeight).toBe(400);
  });

  it('should update snap points correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    const newSnapPoints = ['50%', '90%'];

    act(() => {
      result.current.setSnapPoints(newSnapPoints);
    });

    expect(result.current.snapPoints).toEqual(newSnapPoints);
  });

  it('should update keyboard state correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    act(() => {
      result.current.setKeyboardVisible(true);
      result.current.setKeyboardHeight(300);
    });

    expect(result.current.keyboardVisible).toBe(true);
    expect(result.current.keyboardHeight).toBe(300);
  });

  it('should update presentation state correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    act(() => {
      result.current.setPresented(true);
    });

    expect(result.current.isPresented).toBe(true);
  });

  it('should update current screen correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    const screenProps = { userId: '123' };

    act(() => {
      result.current.setCurrentScreen('AccountCenter', screenProps);
    });

    expect(result.current.currentScreen).toBe('AccountCenter');
    expect(result.current.screenProps).toEqual(screenProps);
  });

  it('should update animation values correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    act(() => {
      result.current.setFadeAnimValue(1);
      result.current.setSlideAnimValue(0);
      result.current.setHandleScaleAnimValue(1.2);
    });

    expect(result.current.fadeAnimValue).toBe(1);
    expect(result.current.slideAnimValue).toBe(0);
    expect(result.current.handleScaleAnimValue).toBe(1.2);
  });

  it('should detect expansion state correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    // Initially not expanded
    expect(result.current.isExpanded()).toBe(false);

    // Set both snap points to the same value (expanded state)
    act(() => {
      result.current.setSnapPoints(['85%', '85%']);
    });

    expect(result.current.isExpanded()).toBe(true);
  });

  it('should reset animations correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    // Set some animation values
    act(() => {
      result.current.setFadeAnimValue(1);
      result.current.setSlideAnimValue(0);
      result.current.setHandleScaleAnimValue(1.5);
    });

    // Reset animations
    act(() => {
      result.current.resetAnimations();
    });

    expect(result.current.fadeAnimValue).toBe(0);
    expect(result.current.slideAnimValue).toBe(50);
    expect(result.current.handleScaleAnimValue).toBe(1);
  });

  it('should update snap points for keyboard correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    // Set initial snap points
    act(() => {
      result.current.setSnapPoints(['60%', '85%']);
    });

    // Simulate keyboard appearing
    act(() => {
      result.current.setKeyboardVisible(true);
      result.current.updateSnapPointsForKeyboard(800);
    });

    // Should use the highest snap point for both when keyboard is visible
    expect(result.current.snapPoints).toEqual(['85%', '85%']);
  });

  it('should update snap points for content correctly', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    const screenHeight = 800;

    // Set content height and trigger update
    act(() => {
      result.current.setContentHeight(600); // Large content
      result.current.setKeyboardVisible(false); // Keyboard not visible
      result.current.updateSnapPointsForContent(screenHeight);
    });

    // For large content (600 > 0.6 * 800), should use content-based snap point
    expect(result.current.snapPoints[0]).toBe('80%'); // Math.min(Math.ceil((600 + 40) / 800 * 100), 90) + '%'
  });

  it('should not update snap points for content when keyboard is visible', () => {
    const { result } = renderHook(() => useBottomSheetStore());

    const originalSnapPoints = ['60%', '85%'];

    act(() => {
      result.current.setSnapPoints(originalSnapPoints);
      result.current.setContentHeight(600);
      result.current.setKeyboardVisible(true); // Keyboard visible
      result.current.updateSnapPointsForContent(800);
    });

    // Should not change snap points when keyboard is visible
    expect(result.current.snapPoints).toEqual(originalSnapPoints);
  });
});