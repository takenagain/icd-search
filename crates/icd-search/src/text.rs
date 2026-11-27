//! Text analysis shared by the indexer, the query parser and the highlighter.
//! Indexing and querying must go through exactly the same functions.

/// A token of a text: folded (lower-case, accents removed) plus the byte span
/// it covers in the original string, so matches can be highlighted verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tok {
    pub s: String,
    pub start: usize,
    pub end: usize,
}

/// Lower-case and strip common Latin diacritics. Output is appended to `out`.
pub fn fold_char(c: char, out: &mut String) {
    for l in c.to_lowercase() {
        match l {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => out.push('a'),
            'ç' | 'ć' | 'č' => out.push('c'),
            'ď' | 'đ' => out.push('d'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => out.push('i'),
            'ł' => out.push('l'),
            'ñ' | 'ń' | 'ň' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => out.push('o'),
            'ř' => out.push('r'),
            'ś' | 'š' | 'ş' => out.push('s'),
            'ť' => out.push('t'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'ź' | 'ż' | 'ž' => out.push('z'),
            'æ' => out.push_str("ae"),
            'œ' => out.push_str("oe"),
            'ß' => out.push_str("ss"),
            other => out.push(other),
        }
    }
}

pub fn fold(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        fold_char(c, &mut o);
    }
    o
}

/// Split into alphanumeric tokens. An apostrophe between two letters does not
/// split a word ("Crohn's" -> "crohns"); every other character does.
pub fn tokenize(text: &str) -> Vec<Tok> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut start, mut end) = (0, 0);
    for (i, &(bi, c)) in chars.iter().enumerate() {
        if c.is_alphanumeric() {
            if cur.is_empty() {
                start = bi;
            }
            fold_char(c, &mut cur);
            end = bi + c.len_utf8();
        } else if (c == '\'' || c == '\u{2019}')
            && !cur.is_empty()
            && chars.get(i + 1).is_some_and(|&(_, n)| n.is_alphanumeric())
        {
            // inner apostrophe: keep the token open
        } else if !cur.is_empty() {
            out.push(Tok { s: std::mem::take(&mut cur), start, end });
        }
    }
    if !cur.is_empty() {
        out.push(Tok { s: cur, start, end });
    }
    out
}

/// Conservative plural folding: enough to make "infections"/"infection" meet,
/// not a real stemmer. Applied to index terms and query terms alike.
pub fn stem(t: &str) -> String {
    let n = t.len();
    if n <= 3 || !t.is_ascii() || t.bytes().all(|b| b.is_ascii_digit()) {
        return t.to_string();
    }
    if t.ends_with("ies") && n > 4 {
        return format!("{}y", &t[..n - 3]);
    }
    if t.ends_with("sses") {
        return t[..n - 2].to_string();
    }
    if t.ends_with('s') && !t.ends_with("ss") && !t.ends_with("us") && !t.ends_with("is") {
        return t[..n - 1].to_string();
    }
    t.to_string()
}

const STOP: &[&str] = &[
    "a", "an", "the", "of", "and", "or", "in", "on", "to", "with", "without", "by", "for", "due",
    "from", "as", "at", "is", "its", "than", "that", "this",
];

pub fn is_stop(t: &str) -> bool {
    STOP.contains(&t)
}

/// Optimal-string-alignment distance (insert/delete/substitute/transpose),
/// abandoned as soon as it must exceed `max`. ASCII only.
pub fn osa_within(a: &[u8], b: &[u8], max: usize) -> Option<usize> {
    let (n, m) = (a.len(), b.len());
    if n.abs_diff(m) > max {
        return None;
    }
    let mut prev2: Vec<usize> = vec![0; m + 1];
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut cur: Vec<usize> = vec![0; m + 1];
    for i in 1..=n {
        cur[0] = i;
        let mut row_min = cur[0];
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(prev2[j - 2] + 1);
            }
            cur[j] = v;
            row_min = row_min.min(v);
        }
        if row_min > max {
            return None;
        }
        std::mem::swap(&mut prev2, &mut prev);
        std::mem::swap(&mut prev, &mut cur);
    }
    let d = prev[m];
    (d <= max).then_some(d)
}

/// Normalise a code for comparison: upper-case, no dots/spaces/dashes.
pub fn code_norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_and_folds() {
        let t: Vec<String> = tokenize("Crohn's disease, Müllerian-duct").into_iter().map(|t| t.s).collect();
        assert_eq!(t, ["crohns", "disease", "mullerian", "duct"]);
    }

    #[test]
    fn spans_cover_original_text() {
        let text = "Bell palsy";
        let t = tokenize(text);
        assert_eq!(&text[t[1].start..t[1].end], "palsy");
    }

    #[test]
    fn stems_plurals() {
        assert_eq!(stem("infections"), "infection");
        assert_eq!(stem("anomalies"), "anomaly");
        assert_eq!(stem("virus"), "virus");
        assert_eq!(stem("diagnosis"), "diagnosis");
        assert_eq!(stem("crohns"), "crohn");
        assert_eq!(stem("2"), "2");
    }

    #[test]
    fn edit_distance() {
        assert_eq!(osa_within(b"palsy", b"plasy", 1), Some(1)); // transposition
        assert_eq!(osa_within(b"diabetes", b"diabtes", 1), Some(1));
        assert_eq!(osa_within(b"abc", b"xyz", 2), None);
        assert_eq!(code_norm("8b88.0"), "8B880");
    }
}
