var dataObj = require(`./${process.argv[2]}`);

//var dataObj = JSON.parse(data);
var metaDatas = {};
var outputObjects = {};

var main = function() {
  if (process.argv.length < 5) {
    console.log(process.argv.length);
    console.log("Run the command like \nnode app.js <input data file> <output data file> [plan, files]");
    return;
  }
  if (process.argv[4] === "files") {
    processObjectList2(runQuery("Select Id, Name, Industry, (Select FirstName, LastName, Email, Phone From Contacts) From Account"));
  }
}

var runQuery = function(soql) {
  var cp = require('child_process');
  var cmd = 'force query "' + soql + '" --format:json'
  var stdout = cp.execSync(cmd).toString();
  return JSON.parse(stdout); 
}

var getMetadata = function(objectName) {
	if (!metaDatas[objectName]) {
		var cp = require('child_process');
		var cmd = 'force describe -t sobject -n ' + objectName + ' -j';

		var stdout = cp.execSync(cmd).toString();
  		var md = JSON.parse(stdout);
  		metaDatas[objectName] = md;
	} 
	return metaDatas[objectName];
}

var isQueryResult = function(objectName, fieldName) {
	var result = false;
	var md = getMetadata(objectName);
	return md.childRelationships.some(function(cr) {
		if (cr.relationshipName === fieldName) {
			result = true;
			return result;
		}
	});
	return result;
}

var isEmail = function(objectName, fieldName) {
  var result = false;
  var md = getMetadata(objectName);
  for (var i=0;i<md.fields.length;i++) {
    fld = md.fields[i];
    if (fld.name === fieldName) {
      if (fld.type === "email") {
        result = true;
        break;
      }
    }
  };
  return result;
}

var getRelationshipFieldName = function(objectName, parentName) {
	var md = getMetadata(objectName);
	var result;
	md.fields.some(function(field) {
		if (field.type === "reference") {
			for (var i=0;i<field.referenceTo.length;i++) {
				if (field.referenceTo[i] === parentName) {
					result = field.name;
					return true;
				}
			}
		}
	});
	return result;
}
var rootType;
var compositeObj;
var index = 0;

var processObjectList2 = function(rootObj) {
  var cobj = processObjectArray(rootObj);
  writeFile(process.argv[3], cobj);
  console.log(process.argv[3] + " created.");
}

var processObjectArray = function(rootObj) {
  var cObj = { records: [] };

  rootObj.forEach(function(obj) {
    var record = { attributes: {
      type: obj.attributes.type,
      referenceId: "ref" + index++ 
    }};
    
    for (var key in obj) {
      if (key !== "attributes" && key !== "Id") {
        if (isQueryResult(obj.attributes.type, key)) {
          record[key] = processObjectArray(obj[key].records);
        } else {
          if (obj[key] !== null) {
            if (isEmail(obj.attributes.type, key)) {
              if (validateEmail(obj[key])) {
                record[key] = obj[key];
              }
            } else {
              record[key] = obj[key];
            }
          }
        }
      }
    }
    
    cObj.records.push(record);
  });
  return cObj;
}

var processObjectList = function(rootObj, referenceId, parentReference) {
	if (Array.isArray(rootObj)) {
		rootType = rootObj[0].attributes.type;
		getMetadata(rootType)
		console.log("Processing a " + rootType + " query.\n");
		rootObj.forEach(function(obj) {
      outputObject = { attributes:
                        { 
                          type: rootType, 
                          referenceId: referenceId || obj.Id 
                        }
                      };
      outputObjects[obj.Id] = outputObject;
			for (var key in obj) {
				if (key === "attributes") {
					// Got some attributes, we want to do something with this.
					// it will have a type and url in it.
				} else {
					if (isQueryResult(rootType, key) === true) {
						// This should be child records. We could go re-entrant here
						var qr = obj[key];
						var parentReferenceField = getRelationshipFieldName(qr.records[0].attributes.type, rootType);

						processObjectList(obj[key].records, obj.Id, { name: parentReferenceField, key: obj.Id});
					} else {
						// Regular field value
            if (key !== "Id") {
              outputObjects[obj.Id][key] = obj[key];
            }
					}
				}
        if (parentReference) {
          outputObjects[obj.Id][parentReference.name] = "@" + parentReference.key;
        }
			}
		})
	}
}

var finalList = {};

var postProcessObjectList = function() {
  var i = 0;  
    Object.keys(outputObjects).forEach(function(key) {
      obj = outputObjects[key];
      if (!finalList[obj.attributes.type]) {
        finalList[obj.attributes.type] = []
      } 
      finalList[obj.attributes.type].push(obj);
    });
    finalList;
}

var validateEmail = function(email) {
    var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

var writeFile = function(filename, data) {
  var fs = require('fs');
    fs.writeFile(filename, JSON.stringify(data, null, 4), function(err) {
      if (err) {
        return console.log(err);
      }
    });  
}

var writeFiles = function() {
  var fs = require('fs');
  var plan = [];
  Object.keys(finalList).forEach(function(key) {
    fileName = key + "s.json";
    var output = { records: finalList[key] };
    fs.writeFile(fileName, JSON.stringify(output, null, 4), function(err) {
      if (err) {
        return console.log(err);
      }
    });
    aplan = {sobject: key, files: [ fileName ] };
    if (rootType === key) {
      aplan["saveRefs"] = true;
    } else {
      aplan["resolveRefs"] = true;
    }
    plan.push(aplan)
    console.log("Created " + fileName);
  });
  fs.writeFile("test_plan.json", JSON.stringify(plan, null, 4), function(err) {
    if (err) {
      return console.log(err);
    }
  });
}
main();
//processObjectList2(dataObj);
//postProcessObjectList();
//writeFiles();
//console.log(process.argv[2], process.argv[3]);
//console.log(JSON.stringify(compositeObj, null, 4));
//console.log(data);



