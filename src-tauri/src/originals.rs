use std::{borrow::Cow, sync::Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

// Keep the clipboard owner alive, required by X11 and Wayland after a copy.
#[derive(Default)]
pub struct ClipboardState(Mutex<Option<arboard::Clipboard>>);

fn with_clipboard<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
) -> Result<T, String> {
    let state = app.state::<ClipboardState>();
    let mut clipboard = state.0.lock().map_err(|e| e.to_string())?;
    if clipboard.is_none() {
        *clipboard =
            Some(arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?);
    }
    f(clipboard.as_mut().unwrap()).map_err(|e| format!("Could not copy to clipboard: {e}"))
}

fn set_image(app: &tauri::AppHandle, image: &tauri::image::Image<'_>) -> Result<(), String> {
    with_clipboard(app, |clipboard| {
        clipboard.set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Borrowed(image.rgba()),
        })
    })
}

/// Decode the device's native PNG so the clipboard receives original pixels.
fn decode_screen(png: &[u8]) -> Result<tauri::image::Image<'static>, String> {
    tauri::image::Image::from_bytes(png)
        .map_err(|e| format!("Could not decode the screen image: {e}"))
}

#[tauri::command]
pub async fn copy_original_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = super::owned_path(&app, &path)?;
        if path.extension().is_none_or(|e| e != "png") {
            return Err("Choose a PNG screenshot to copy as an image.".into());
        }
        let image = tauri::image::Image::from_path(path).map_err(|e| e.to_string())?;
        set_image(&app, &image)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy a fresh native-resolution screenshot to the clipboard without saving a
/// library file. Uses the same screencap path as `screenshot`, not the
/// downscaled live preview.
#[tauri::command]
pub async fn copy_screen(app: tauri::AppHandle, serial: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = decode_screen(&super::screen(&app, &serial)?)?;
        set_image(&app, &image)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn copy_capture_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() || paths.len() > 100 {
            return Err("Select between 1 and 100 captures.".into());
        }
        let files = paths
            .iter()
            .map(|p| super::owned_path(&app, p))
            .collect::<Result<Vec<_>, _>>()?;
        with_clipboard(&app, |clipboard| clipboard.set().file_list(&files))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_original(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = super::owned_path(&app, &path)?;
        let name = source.file_name().unwrap().to_string_lossy();
        let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("png");
        let destination = app
            .dialog()
            .file()
            .set_file_name(name.to_string())
            .add_filter("Original capture", &[extension])
            .blocking_save_file();
        let Some(destination) = destination else {
            return Ok(false);
        };
        let destination = destination.into_path().map_err(|e| e.to_string())?;
        if destination.canonicalize().ok().as_ref() == Some(&source) {
            return Ok(true);
        }
        std::fs::copy(source, destination).map_err(|e| format!("Could not save original: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    // A 1×1 transparent RGBA PNG, the same format `screencap -p` emits.
    const PNG: [u8; 67] = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
        0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
        0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    #[test]
    fn screen_copy_decodes_native_png_in_memory() {
        let image = super::decode_screen(&PNG).unwrap();
        assert_eq!((image.width(), image.height()), (1, 1));
        assert_eq!(image.rgba().len(), 4);
        assert!(super::decode_screen(b"not an image").is_err());
    }
}
