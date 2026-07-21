import { getSurfaceConfig, getSurfacePresentation } from '../surfaceRegistry';

/**
 * `getSurfaceConfig` resolves which Bloom surface a route is presented in. The
 * flagship image picker (FileManagement in image-only select mode) upgrades to a
 * full-bleed `'fullScreen'` surface that owns its own scrolling; every other
 * route stays on the responsive `'sheet'`. These guard the routing contract.
 */
describe('getSurfaceConfig presentation', () => {
    const imageOnlyPickerProps = {
        selectMode: true,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
    };

    it('defaults every route to the responsive sheet', () => {
        expect(getSurfaceConfig('ManageAccount', {}).presentation).toBe('sheet');
        expect(getSurfaceConfig('AvatarCrop', {}).presentation).toBe('sheet');
        expect(getSurfacePresentation('ManageAccount', {})).toBe('sheet');
    });

    it('routes the FileManagement image-only picker to a full-screen surface', () => {
        const config = getSurfaceConfig('FileManagement', imageOnlyPickerProps);
        expect(config.presentation).toBe('fullScreen');
        // The full-bleed picker owns its own FlatList → the host must not wrap it.
        expect(config.scrollable).toBe(false);
    });

    it('keeps FileManagement on the sheet when it is not an image-only picker', () => {
        // Browse mode (no selectMode) — the standard file manager.
        expect(getSurfaceConfig('FileManagement', {}).presentation).toBe('sheet');
        // Select mode that still allows non-image types is not the flagship picker.
        expect(
            getSurfaceConfig('FileManagement', {
                selectMode: true,
                disabledMimeTypes: ['video/'],
            }).presentation,
        ).toBe('sheet');
    });
});
