fn main() {
    let dist = std::path::Path::new("dist");
    let parent_dist = std::path::Path::new("../dist");
    let target = if parent_dist.exists() || !dist.exists() {
        parent_dist
    } else {
        dist
    };
    if !target.exists() {
        let _ = std::fs::create_dir_all(target);
        let _ = std::fs::write(
            target.join("index.html"),
            "<!doctype html><html><body>Run npm run build</body></html>",
        );
    }
    tauri_build::build()
}
