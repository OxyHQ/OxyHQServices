import { getSheetConfig } from '../routes';

/**
 * `getSheetConfig` drives which surface `BottomSheetRouter` mounts a route in.
 * The flagship image picker (FileManagement in image-only select mode) resolves
 * to `presentation: 'dialog'`; every other route stays `'sheet'`. These guard
 * the routing contract so the ~28 sheet screens keep the in-tree BottomSheet.
 */
describe('getSheetConfig presentation', () => {
    const imageOnlyPickerProps = {
        selectMode: true,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
    };

    it('defaults every route to the in-tree sheet', () => {
        expect(getSheetConfig('ManageAccount', {}).presentation).toBe('sheet');
        expect(getSheetConfig('AvatarCrop', {}).presentation).toBe('sheet');
        expect(getSheetConfig(null, {}).presentation).toBe('sheet');
    });

    it('routes the FileManagement image-only picker to the Dialog', () => {
        expect(getSheetConfig('FileManagement', imageOnlyPickerProps).presentation).toBe('dialog');
    });

    it('keeps FileManagement on the sheet when it is not an image-only picker', () => {
        // Browse mode (no selectMode) — the standard file manager.
        expect(getSheetConfig('FileManagement', {}).presentation).toBe('sheet');
        // Select mode that still allows non-image types is not the flagship picker.
        expect(
            getSheetConfig('FileManagement', {
                selectMode: true,
                disabledMimeTypes: ['video/'],
            }).presentation,
        ).toBe('sheet');
    });
});
