# lazada-plus-v1 / _general

> Generated from adapter notes and probe bundles. Rebuild via `/knowledge/rebuild` or after probe runs.

## endpoint

### Lazada Voucher DOM Findings / Conflict Handling Findings

Deactivate flow:
Clicking `Deactivate` opens a confirm dialog
Confirm dialog text: `Are you sure to deactivate this promotion`
Confirm buttons: `Cancel`, `OK`
On success, the row is usually not removed; status changes from `Not Started` to `Suspended`
Action set changes from `Deactivate` to `Activate`
Important caveat:
Lazada may still emit a noisy message like `[CAMPAIGN_STATUS_NOT_VERIFIED]... actual:6` even when the row has already switched to `Suspended`
Lazada may also emit a lock error like `[R-10004-05-11-002] fail to lock distributeLocker ...` when the same campaign state-change request is already being processed in backend
Because of that, automation should verify row state and action changes, not rely only on toast text
In live MY tests, `actual:6` matched the already-suspended outcome after deactivation, so the message behaved like a stale backend validation warning instead of a true rollback
Result export should treat this as a runtime warning instead of a hard failure when the list row has already become `Suspended` or disappeared
To avoid self-triggered lock conflicts, the confirm dialog should be acknowledged once and then wait for row-state change instead of repeatedly clicking `OK`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Flexi Submit Findings

MY:
`Flexi Combo` submit can succeed through the existing live path after conflicting rows are cleaned up
SG:
`Flexi Combo` form can remain on the create page with no visible error when the footer `Submit` button is clicked only through DOM / CDP
The button itself is enabled and the form fields can be fully filled with no inline validation errors
Triggering the React `onClick` handler on the `Submit` button reliably sends the request and navigates to the list page
Implementation implication:
Flexi submit should prefer React `onClick`
CDP click remains useful as a fallback, but should not be the primary submit path for SG

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / MY / SG Parity

Observed parity:
Home page tool layout is structurally the same in MY and SG
The four requested tools exist in both MY and SG
Regular Voucher create page structure matches between MY and SG
The main visible difference is currency (`RM` vs `S$`) and smart-value defaults
Conclusion:
Multi-site support should be implemented as `site -> domain -> path`
Form-filling logic can be shared, with currency readback treated as display-only

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

## note

### Lazada Voucher DOM Findings

Test date: 2026-04-01
Verified sites:
MY (`https://sellercenter.lazada.com.my`)
SG (`https://sellercenter.lazada.sg`)
Primary entry:
`https://sellercenter.lazada.com.my/apps/promotion/home`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings

Test date: 2026-04-21
Scope:
Re-probe the actual create flow for `ID / MY / PH / SG / TH / VN`
Cover four tools:
`Regular Voucher`
`Store New Buyer Voucher`
`Store Follower Voucher`
`Flexi Combo`
For voucher pages, verify the real field set after selecting:
`Entire Shop`
`Percentage Discount Off`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / Compatibility Matrix

`Regular Voucher`
`MY / PH / SG / TH / VN`: reachable and flow-probed
`ID`: blocked by account-health redirect
`Store New Buyer Voucher`
`MY / PH / SG / TH / VN`: reachable and flow-probed
`ID`: blocked by account-health redirect
`Store Follower Voucher`
`MY / PH / SG / TH / VN`: reachable and flow-probed
`ID`: blocked by account-health redirect
`Flexi Combo`
`MY / PH / SG / TH / VN`: reachable and flow-probed
`ID`: blocked by account-health redirect

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / Create URL Map

Promotions home:
`/{domain}/apps/promotion/home`
Regular Voucher:
`/{domain}/apps/voucher/create?action=create&moduleType=REGULAR_VOUCHER`
Flexi Combo:
`/{domain}/apps/promotion/flexicombo/create`
Store New Buyer Voucher:
`/{domain}/apps/voucher/create?action=create&voucherDisplayArea=STORE_NEW_BUYER_ONLY`
Store Follower Voucher:
`/{domain}/apps/voucher/create?action=create&moduleType=STORE_FOLLOWER_VOUCHER`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / First-Pass Automation Scope

Good v1 candidates for live fill:
Regular Voucher, Entire Shop
Store New Buyer Voucher, Entire Shop
Store Follower Voucher, Entire Shop
Flexi Combo `Money/Discount Off` with tier rows and Entire Shop
Research-complete but live-pending:
Any `Specific Products` path
Flexi Combo gift/sample product picker
Flexi Combo Combo Buy gift/sample product picker
Flexi Combo Fixed Price product selection

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Fixed Price

Observed structure:
no repeated tier list
`Number of items`
`Total price`
`Discount Apply To` is forced to `Specific Products`
Template implication:
Fixed Price can stay on the master sheet
It still cannot use the v1 entire-shop-only live path

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Flexi Combo

Live page title:
`Flexi Combo - Lazada Seller Center`
Top-level sections:
`Basic Promotion Setting`
`Discount Setting`
`Product Setting`
`Tips`
Always-present base fields:
`Promotion Name`
`Effective Period`
`Discount Apply To`
`Total number of Flexi Combo Orders`
Main type cards discovered:
`Money/Discount Off`
`Free gift/sample`
`Combo Buy`
`Fixed Price`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / ID

All tested URLs were redirected to:
`https://sellercenter.lazada.co.id/apps/seller/account_health`
This includes:
promotion home
voucher list
voucher create
flexi list
flexi create
Observed page title:
`Kesehatan Akun - Lazada Seller Center`
Operational conclusion:
Current account cannot reach the Lazada promotion workflow on `ID`.
Adapter should stop early with a clear live-scope warning instead of retrying forever.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / MY / PH / SG / TH / VN

Confirmed reachable:
`apps/promotion/home`
`apps/promotion/voucher/list?...`
`apps/voucher/create?...`
`apps/promotion/flexicombo/create`
Observed titles:
`Create Regular Voucher - Lazada Seller Center`
`Create Store New Buyer Voucher - Lazada Seller Center`
`Create Store Follower Voucher - Lazada Seller Center`
`Flexi Combo - Lazada Seller Center`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / Money/Discount Off

Sub-options:
`Money Value Off`
`Percentage Discount Off`
Conditional controls:
`Stackable Discount` appears in the money-value path
`Deal Criteria`
`Item Quantity Reaches X`
`Order Value Reaches X`
`Add Tier`
Tier behavior:
Each click on `Add Tier` appends a new `Tier N` block
Tier blocks are repeated dynamic sections
`Item Quantity Reaches X` changes the threshold label to `If quantity value >=`
`Order Value Reaches X` changes the threshold label to `If order value >=`
Template implication:
Flexi Combo cannot stay in a single flat row model only
Use a master sheet plus child tier sheet keyed by `唯一键`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Regular Voucher

Live page title:
`Create Regular Voucher - Lazada Seller Center`
Confirmed fields:
`Promotion Name`
`Voucher Use Time Type`
`Voucher Redeem Period`
`Collect Start Time`
`Voucher Apply To`
Discount card switch: `Money Value Off` / `Percentage Discount Off`
`If Order Min.Spend`
`Discount would be`
`Voucher Limit per Customer`
`Discount Budget`
`Voucher Budget`
Confirmed options and behavior:
`Voucher Use Time Type`
`Fixed time`
`Use after collection`
`Voucher Apply To`
`Entire Shop`
`Specific Products (Please select products after submission)`
`Discount Budget`
`Limited Budget`
`Unlimited Budget`
Single-control findings:
Switching `Use after collection` removes `Voucher Redeem Period` and replaces it with:
`Use Within Days after voucher collection`
`Collect Time`
Switching discount card from `Money Value Off` to `Percentage Discount Off` changes:
`Discount would be` unit from currency to `% off`
adds `Maximum Discount per Order`
replaces budget section with `Total Voucher to be Issued`
Automation impact:
Template must keep conditional fields for fixed-time vs after-collection
Template must keep conditional fields for money-off vs percent-off
`Specific Products` is not a same-form inline picker; product selection happens after submission

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Runtime Implication

Adapter policy after this round:
keep `MY / PH / SG / TH / VN` in verified live scope
explicitly fail fast for `ID` with an account-health redirect explanation
treat `VN` as a supported live site

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / Store Follower Voucher

Live page title:
`Create Store Follower Voucher - Lazada Seller Center`
Confirmed fields:
`Promotion Name`
`Voucher Use Time Type`
`Voucher Redeem Period`
`Collect Start Time`
`Voucher Apply To`
Discount card switch: `Money Value Off` / `Percentage Discount Off`
`If Order Min.Spend`
`Discount would be`
`Total Voucher to be Issued`
`Voucher Limit per Customer`
Special findings:
`Specific Products` exists visually but is disabled on the tested page
Tips panel explains follower-growth use case but does not change core form structure
Automation impact:
v1 should reject `Specific Products` for Store Follower Voucher

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Summary

Verified live create-flow sites:
`MY`
`PH`
`SG`
`TH`
`VN`
Blocked site in current account:
`ID`
Main conclusion:
`MY / PH / SG / TH / VN` can all enter the real create flow.
After switching to `Entire Shop + Percentage Discount Off`, the voucher pages converge to the same effective field model:
`Min Spend`
`Discount`
`Maximum Discount per Order`
`Total Voucher to be Issued`
`Voucher Limit per Customer`
`VN` was not a missing-field problem on the page itself; the issue was automation stability:
wrong click target on the discount card
brittle field lookup on the VN page
stale create-page reuse across rows
`ID` is currently not a field-compatibility problem. The platform redirects all tested promotion URLs to `account_health`.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / Template Decision

Workbook shape:
`Vouchers` sheet: one row per promotion
`FlexiTiers` sheet: one row per tier, linked by `唯一键`
`Instructions` sheet: field explanations and allowed values
Why this shape:
The three voucher tools fit a mostly flat row model with conditional columns
Flexi Combo has repeated tier blocks and cannot be represented reliably in a single flat sheet

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Voucher Page Convergence

Test method:
Open the real create page
Click `Entire Shop`
Click `Percentage Discount Off`
Read the post-switch field set
Observed convergence on:
`MY`
`PH`
`SG`
`TH`
`VN`
Post-switch effective field set:
`Promotion Name`
`Voucher Redeem Period`
`Collect Start Time`
`Entire Shop`
`Percentage Discount Off`
`If Order Min.Spend` or local equivalent
`Discount would be` or local equivalent
`Maximum Discount per Order`
`Total Voucher to be Issued`
`Voucher Limit per Customer`
Important note:
Some sites show `Voucher Budget` or `Discount Budget` in the initial default state.
That is not the effective field set after switching into the tested target flow.
The live adapter path should therefore key off the post-switch form, not the untouched default card state.

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

## page-shape

### Lazada Voucher DOM Findings / Country Switching

Best path:
Use a site-domain map plus `/{site}/apps/promotion/home`
From that home page, enter the concrete create page for the target tool
Why:
On promotions home, the right sidebar country links are stable and switch to each site home
On voucher create pages, the right sidebar country links downgrade to a generic `/apps/voucher/create` URL and lose the coupon-type query
Because of that, cross-site automation should not switch country from an already-open create form
Domain map confirmed on live page:
MY: `https://sellercenter.lazada.com.my`
SG: `https://sellercenter.lazada.sg`
ID: `https://sellercenter.lazada.co.id`
PH: `https://sellercenter.lazada.com.ph`
TH: `https://sellercenter.lazada.co.th`
VN: `https://sellercenter.lazada.vn`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Flexi Combo Findings

Reachable and consistent on:
`MY`
`PH`
`SG`
`TH`
`VN`
Observed stable elements:
title `Flexi Combo - Lazada Seller Center`
`Promotion Name`
`Effective Period`
`Money/Discount Off`
`Percentage Discount Off`
`Entire Shop`
`Add Tier`
`Total number of Flexi Combo Orders`
placeholders such as `Quantity Value, eg. 3` and `Discount value, eg. 5`

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

### Lazada Voucher DOM Findings / List Page Findings

Voucher list URL:
`/{domain}/apps/promotion/voucher/list?moduleType=REGULAR_VOUCHER`
`/{domain}/apps/promotion/voucher/list?moduleType=STORE_NEW_BUYER_VOUCHER`
`/{domain}/apps/promotion/voucher/list?moduleType=STORE_FOLLOWER_VOUCHER`
Flexi list URL:
`/{domain}/apps/promotion/flexicombo/list`
Observed list behavior:
Voucher list pages can still show mixed voucher tools even when `moduleType` is present
Row text always contains a stable `ID: {promotion_id}` fragment
Date range is rendered as `From YYYY-MM-DD HH:mm:ss To YYYY-MM-DD HH:mm:ss`
Not-started rows expose inline actions such as `Edit`, `Duplicate`, `Deactivate`
Suspended rows expose `View`, `Duplicate`, `Activate`
Search box findings:
Voucher list search input placeholder: `Voucher Name / Promotion Id`
Flexi list search input placeholder: `Promotion Name / Promotion Id`
The search input is a React `Search` / auto-complete control, not a plain HTML form input
Direct `input.value=` plus Enter does not reliably trigger filtering

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Store New Buyer Voucher

Live page title:
`Create Store New Buyer Voucher - Lazada Seller Center`
Confirmed fields:
`Promotion Name`
`Voucher Use Time Type`
`Voucher Redeem Period`
`Collect Start Time`
`Voucher Apply To`
`Eligible Customer`
Discount card switch: `Money Value Off` / `Percentage Discount Off`
`If Order Min.Spend`
`Discount would be`
`Total Voucher to be Issued`
`Voucher Limit per Customer`
Special findings:
`Eligible Customer` is fixed as `Store New Buyer`
The page shows inline risk text when discount ratio is high
After a successful create, Lazada may show a recommendation modal:
Title: `One last step to feature your Store New Buyer Voucher`
CTA: `Decorate now`
The modal has a close icon in the top-right corner
This modal is post-success guidance, not a required confirmation step
Automation impact:
No need to expose `Eligible Customer` as a free-form business field
Keep `Total Voucher to be Issued` in the master template for this tool
Automation can treat the recommendation modal as a success signal and may close it for cleanup

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / VN Findings

Page title:
`Create Regular Voucher - Lazada Seller Center`
Root cause of the earlier failure:
The page really does expose the target input fields.
The automation was unstable for three reasons:
it could click the label leaf instead of the actual radio/card container
it relied on brittle label-container lookup on VN
it could reuse a dirty create page from the previous row
Fixes applied:
click the real radio/card container instead of the text leaf
add VN-specific section-based input lookup for the percentage-discount block
relax numeric write-back verification for formatted values like `500000` vs `500,000`
force a create-page refresh before continuing later rows
Validation result:
VN two-row live replay succeeded

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-21.md`

## phase-hint

### Lazada Voucher DOM Findings / Combo Buy

Sub-options:
`Percentage Discount Off & Free Gift(s)`
`Money Value Off & Free Gift(s)`
`Percentage Discount Off & Free Sample(s)`
`Money Value Off & Free Sample(s)`
Additional controls:
`Free Shipping for Gift/Sample`
`Stackable Discount`
gift/sample tier block
Template implication:
Same parent-child model as gift/sample
Still requires later live-phase work for gift product selection

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`

### Lazada Voucher DOM Findings / Free gift/sample

Sub-options:
`Free Gift(s) only`
`Free Sample(s) only`
Additional controls:
`Free Shipping for Gift/Sample`
`Stackable Discount`
`Add Free Gift/Sample`
`Let buyer choose out of free gifts`
Template implication:
Gift/sample quantity and optional buyer-choice count belong at tier level
Actual gift-product picker modal still needs a later live-phase probe

Source: `/Users/xingyicheng/Documents/crawshrimp-harness/.ds-e2e/adapters/lazada-plus-v1/notes/dom-findings-2026-04-01.md`
