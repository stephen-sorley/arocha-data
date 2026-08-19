Private donor data that we don't want to commit to GitHub will be stored here during a build.

You also need to manually import Click and Pledge data in JSON format. We do
this by going to the Click and Pledge Google sheet, exporting as CSV, then
converting it to JSON using "csvtojson" on linux.