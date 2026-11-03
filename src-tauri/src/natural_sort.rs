use std::cmp::Ordering;

/// Compare pre-folded filename keys, treating ASCII digit runs as integers.
/// No allocation or integer parsing is needed, even for very long identifiers.
/// Equal numeric values defer leading-zero differences until the rest of the
/// name has been compared, so `02a` still precedes `2b`.
pub(crate) fn natural_cmp(left: &str, right: &str) -> Ordering {
    let (mut left, mut right) = (left.as_bytes(), right.as_bytes());
    let mut padding_order = Ordering::Equal;
    while let (Some(&a), Some(&b)) = (left.first(), right.first()) {
        if a.is_ascii_digit() && b.is_ascii_digit() {
            let left_end = left
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(left.len());
            let right_end = right
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(right.len());
            let left_digits = &left[..left_end];
            let right_digits = &right[..right_end];
            let left_value = without_leading_zeros(left_digits);
            let right_value = without_leading_zeros(right_digits);
            let order = left_value
                .len()
                .cmp(&right_value.len())
                .then_with(|| left_value.cmp(right_value));
            if !order.is_eq() {
                return order;
            }
            padding_order = padding_order.then_with(|| left_end.cmp(&right_end));
            left = &left[left_end..];
            right = &right[right_end..];
        } else {
            let order = a.cmp(&b);
            if !order.is_eq() {
                return order;
            }
            left = &left[1..];
            right = &right[1..];
        }
    }
    left.len().cmp(&right.len()).then(padding_order)
}

fn without_leading_zeros(digits: &[u8]) -> &[u8] {
    &digits[digits
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(digits.len())..]
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    #[test]
    fn numeric_prefixes_and_embedded_runs_follow_numeric_order() {
        for names in [
            vec!["1.txt", "2.txt", "9.txt", "10.txt", "11.txt", "100.txt"],
            vec!["image1.jpg", "image2.jpg", "image10.jpg", "image20.jpg"],
            vec!["第2章-3页", "第2章-10页", "第10章-1页"],
            vec!["v1.2.9", "v1.2.10", "v1.10.1"],
        ] {
            let mut actual = names.iter().rev().copied().collect::<Vec<_>>();
            actual.sort_by(|a, b| natural_cmp(a, b));
            assert_eq!(actual, names);
        }
    }

    #[test]
    fn equal_numbers_compare_suffix_before_leading_zero_tiebreak() {
        let expected = ["0", "00", "000", "2", "02", "002", "02a", "2b", "10"];
        let mut actual = expected.into_iter().rev().collect::<Vec<_>>();
        actual.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(actual, expected);
        assert_eq!(natural_cmp("x02y3", "x2y10"), Ordering::Less);
    }

    #[test]
    fn numbers_are_not_limited_to_machine_integer_precision() {
        let smaller = format!("{}9.txt", "9".repeat(80));
        let larger = format!("1{}.txt", "0".repeat(81));
        assert_eq!(natural_cmp(&smaller, &larger), Ordering::Less);
        assert_eq!(
            natural_cmp("9007199254740992.txt", "9007199254740993.txt"),
            Ordering::Less
        );
        assert_eq!(
            natural_cmp("18446744073709551615", "18446744073709551616"),
            Ordering::Less
        );
    }

    #[test]
    fn text_and_unicode_keep_ordinal_order_while_digits_are_natural() {
        assert_eq!(natural_cmp("a", "aa"), Ordering::Less);
        assert_eq!(natural_cmp("é2", "é10"), Ordering::Less);
        assert_eq!(natural_cmp("😀2", "😀10"), Ordering::Less);
        assert_eq!(natural_cmp("中", "文"), "中".cmp("文"));
        assert_eq!(natural_cmp("A2", "a2"), Ordering::Less); // Folding is the caller's job.
    }

    #[test]
    fn comparison_is_total_antisymmetric_and_transitive() {
        let values = [
            "", "a", "A", "1", "01", "001", "0", "00", "2", "02", "10", "1a", "01a", "1b", "01b",
            "a2", "a02", "a10", "1-2", "01-10", "第2章", "第10章", "é", "😀", "２", "2.", "02.",
        ];
        for a in values {
            for b in values {
                let ab = natural_cmp(a, b);
                assert_eq!(ab, natural_cmp(b, a).reverse(), "{a:?} / {b:?}");
                assert_eq!(ab.is_eq(), a == b, "{a:?} / {b:?}");
                for c in values {
                    if ab.is_le() && natural_cmp(b, c).is_le() {
                        assert!(natural_cmp(a, c).is_le(), "{a:?} <= {b:?} <= {c:?}");
                    }
                }
            }
        }
    }
}
