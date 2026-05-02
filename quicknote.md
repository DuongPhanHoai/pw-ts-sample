1. Installation
>> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> 
>> npm init -y
> 
>> npm install -D @playwright/test
> 
>> Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
> 
>> npx playwright install

2. Test implementation in simple
>test site: https://www.saucedemo.com/

>debug command: npx playwright test tests/cart-and-checkout.spec.ts --project=chromium --headed --debug