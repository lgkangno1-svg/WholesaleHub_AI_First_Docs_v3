#!/usr/bin/env python3
import unittest
from unittest.mock import Mock
from reconcile import candidate_links, unavailable_at_supplier

def row(pid, sid, status="approved", post="publish", supplier="walldob2b"):
    return {"woo_parent_id":str(pid),"source_product_id":str(sid),
            "lane_status":status,"post_status":post,"supplier_id":supplier,
            "post_title":"상품"}

class GuardTests(unittest.TestCase):
    def test_only_approved_published_numeric_walldo_absence(self):
        rows=[row(1,"1788167553"),row(2,"1788167554",post="draft"),
              row(3,"1788167555",status="terminal_excluded"),
              row(4,"kyungnam10000"),row(5,"1788167556")]
        found={"1788167556"}
        self.assertEqual(candidate_links(rows,found),[(1,"1788167553","상품")])

    def test_alternate_supplier_is_protected(self):
        rows=[row(1,"1788167553"),row(1,"1001",supplier="sanjiro")]
        self.assertEqual(candidate_links(rows,set()),[])

    def test_mismatched_or_multiple_walldo_mapping_is_protected(self):
        rows=[row(1,"1788167553"),row(1,"1788167554")]
        self.assertEqual(candidate_links(rows,set()),[])

    def test_supplier_detail_requires_specific_unavailable_message(self):
        s=Mock()
        s.get.return_value.status_code=200
        s.get.return_value.text="판매가능한 상품이 아닙니다."
        self.assertTrue(unavailable_at_supplier(s,"1788167553"))
        s.get.return_value.text="상품 구매하기"
        self.assertFalse(unavailable_at_supplier(s,"1788167553"))
        s.get.return_value.status_code=500
        self.assertFalse(unavailable_at_supplier(s,"1788167553"))

if __name__=="__main__":
    unittest.main()
