// dependencies
const AWS = require('aws-sdk');
const util = require('util');
const sharp = require('sharp');

// get reference to S3 client
const s3 = new AWS.S3();

exports.handler = async (event, context, callback) => {

    // Read options from the event parameter.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    const srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey    = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    const fileName  = srcKey.replace(/\.[^/.]+$/, "");

    // Infer the image type from the file suffix.
    const typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        console.log("Could not determine the image type.");
        return;
    }

    // Check that the image type is supported  
    const imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "png") {
        console.log(`Unsupported image type: ${imageType}`);
        return;
    }
    const folder    = /[^/]*$/.exec(fileName)[0] + imageType;

    // set thumbnail width. Resize will set the height automatically to maintain aspect ratio.
    const sizes = [
        {
            name: 'mobile',
            width: 640,
            quality: 40,
            suffix: '-sm',
        },
        {
            name: 'tablet',
            width: 768,
            quality: 60,
            suffix: '-md',
        },
        {
            name: 'small-laptop',
            width: 1080,
            quality: 80,
            suffix: '-lg',
        },
        {
            name: 'widescreen',
            width: 1440,
            quality: 100,
            suffix: '-xl',
        },
        {
            name: 'placeholder',
            width: 1440,
            quality: 30,
            suffix: '-pl',
        },
    ];

    if (
        fileName.endsWith('_nocompression')
        || sizes.some(size => fileName.endsWith(size.suffix))
    ) {
        console.log(`Image not processed: ${imageType}`);
        return;
    }

    // Download the image from the S3 source bucket. 
    try {
        const params = {
            Bucket: srcBucket,
            Key: srcKey
        };
        var origimage = await s3.getObject(params).promise();

    } catch (error) {
        console.log(error);
        return;
    }

    // Use the Sharp module to resize the image and save in a buffer.
    try {
        var buffers = [];
        if (imageType === 'png') {
            buffers = await Promise.all(sizes.map(
                size => sharp(origimage.Body)
                    .resize({
                        width: size.width,
                        withoutEnlargement: true,
                        fastShrinkOnLoad: true,
                    })
                    .png({
                        quality: size.quality,
                        progressive: true,
                        palette: true,
                        compressionLevel: 9,
                    })
                    .toBuffer()
            ));
        } else if (imageType === 'jpg') {
            buffers = await Promise.all(sizes.map(
                size => sharp(origimage.Body)
                    .resize({
                        width: size.width,
                        withoutEnlargement: true,
                        fastShrinkOnLoad: true,
                    })
                    .jpeg({
                        quality: size.quality,
                        progressive: true,
                    })
                    .toBuffer()
            ));
        }
        var webp = await Promise.all(sizes.map(
            size => sharp(origimage.Body)
                .resize({
                    width: size.width,
                    withoutEnlargement: true,
                    fastShrinkOnLoad: true,
                })
                .webp({
                    quality: size.quality,
                    reductionEffort: 6,
                })
                .toBuffer()
        ));
    } catch (error) {
        console.log(error);
        return;
    }

    const destParams = {
        Bucket: srcBucket,
        ContentType: "image",
        Metadata: {
            CacheControl: "public, max-age=31536000",
        },
        ACL: 'public-read',
    };

    // Upload the thumbnail image to the destination bucket
    try {
        const dstPath = fileName + "/" + folder;
        const promises = buffers.map((buffer, index) => {
            return s3.putObject({
                ...destParams,
                Key: dstPath + sizes[index].suffix + "." + typeMatch[1],
                Body: buffer,
            }).promise();
        }).concat(webp.map((buffer, index) => {
            return s3.putObject({
                ...destParams,
                Key: dstPath + sizes[index].suffix + ".webp",
                Body: buffer,
            }).promise();
        }));
        await Promise.all(promises);
    } catch (error) {
        console.log(error);
        return;
    } 

    console.log('Successfully resized ' + srcBucket + '/' + srcKey); 
};