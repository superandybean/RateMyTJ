const express = require('express')
var cookieSession = require('cookie-session')
const {  AuthorizationCode } = require('simple-oauth2');
var https = require('https');
var hbs = require('hbs')
var mysql = require('mysql');
const { RSA_NO_PADDING } = require('constants');
const app = express()
const port = 3000

var filter = require('leo-profanity')

var bodyParser = require('body-parser')
app.use(bodyParser.urlencoded({
  extended: true
}));

app.set('trust proxy', 1)

require('dotenv').config()

app.use(cookieSession({
  name: 'pogchamp',
  keys: [process.env.COOKIE_KEY_1, process.env.COOKIE_KEY_2]
}))

var TERMS = ["Spring 22", "Fall 21", "Summer 21", "Spring 21", "Fall 20", "Summer 20", "Spring 20", "Fall 19", "Summer 19", "Spring 19", "Fall 18", "Summer 18", "2021-22", "2020-21", "2019-20", "2018-19"]

var ion_client_id = 'riogMOPcoOXJdwttjW3mfpM7J7EGagXPx7ebyIit'
var ion_client_secret = process.env.ION_CLIENT_SECRET
var ion_redirect_uri = 'http://localhost:3000/login_worker'

var client = new AuthorizationCode({
  client: {
    id: ion_client_id,
    secret: ion_client_secret,
  },
  auth: {
    tokenHost: 'https://ion.tjhsst.edu/oauth/',
    authorizePath: 'https://ion.tjhsst.edu/oauth/authorize',
    tokenPath: 'https://ion.tjhsst.edu/oauth/token/'
  }
})

var authorizationUri = client.authorizeURL({
  scope: "read",
  redirect_uri: ion_redirect_uri
});

// console.log(authorizationUri)

app.set('view engine', 'hbs')
app.use(express.static(__dirname + '/views'));

hbs.registerPartials(__dirname + '/views/partials')

hbs.registerHelper('fix_number', function(num) {
  if (num === undefined) return "";
  if (num == null) return "";
  return num.toFixed(2);
});

hbs.registerHelper('fix_number_profile', function(num) {
  if (num === undefined) return "";
  if (num == null) return "";
  if ((num+"").substring((num+"").indexOf(".")+1).length < 2) return num;
  if ((num) == 10) return num;
  return num.toFixed(2);
});

hbs.registerHelper('random_number', function(num) {
  var DIGITS = 6
  var s = Math.floor(Math.random() * 10 ** DIGITS) + ""
  while (s.length < DIGITS) s = '0' + s
  return s
});

hbs.registerHelper('format_date', function(d) {
  var s = d.toString()
  return s.substring(s.search(" ")+1, s.search("GMT")-1)
});

hbs.registerHelper('check_empty', function(s, options) {
  if (s === "") {
    return;
  }
  else {
    return options.fn(this)
  }
});

hbs.registerHelper('check_zero', function(n, options) {
  if (n == 0) {
    return options.fn(this)
  }
});

hbs.registerHelper('check_nonzero', function(n, options) {
  if (n != 0) {
    return options.fn(this)
  }
});

hbs.registerHelper('empty_key', function(k, options) {
  if (k === undefined) return options.fn(this)
  if (k.length == 0) {
    return options.fn(this)
  }
})

hbs.registerHelper('no_reviews', function(k, options) {
  if (k === undefined) return options.fn(this)
  if (Object.keys(k).length == 0) {
    return options.fn(this)
  }
})

hbs.registerHelper('capitalize', function(s) {
  return (s.charAt(0)+"").toUpperCase() + s.substring(1)
})

hbs.registerHelper('remove_spaces', function(s) {
  return s.replace(/ /g, "_")
})

hbs.registerHelper('remove_spaces_dashes', function(s) {
  return s.replace(/ /g, "-")
})

hbs.registerHelper('display_bool', function(b) {
  return b ? "yes" : "no"
})

hbs.registerHelper('format_term', function(term) {
  if (term.indexOf(' ') == -1) {
    return "Full Year"
  }
  return term.substring(0, term.indexOf(' '))
})

hbs.registerHelper('find_length', function(s) {
  if (s.indexOf(' ') == -1) {
    return "full_year"
  }
  return "semester"
})

hbs.registerHelper('turn_to_ordinal', function(num) {
  var ones = num % 10
  var tens = num % 100
  if (ones == 1 && tens != 11) {
    return num + "st";
  }
  if (ones == 2 && tens != 12) {
    return num + "nd";
  }
  if (ones == 3 && tens != 13) {
    return num + "rd";
  }
  return num + "th";
})

function checkAuthentication(req, res, next) {
  if ('authenticated' in req.session) {
    next()
  }
  else {
    res.render('no_login', {"login_link": authorizationUri})
  }
}

function getProfileData(req,res,next) {
  if ('authenticated' in req.session) {

    var access_token = req.session.token.access_token;
    var profile_url = 'https://ion.tjhsst.edu/api/profile?format=json&access_token='+access_token;

    // console.log(access_token)
    // console.log(profile_url)

    https.get(profile_url, function(response) {
      var rawData = '';
      response.on('data', function(chunk) {
          rawData += chunk;
      });

      response.on('end', function() {
        res.locals.profile = JSON.parse(rawData);
        if (res.locals.profile.detail == "Authentication credentials were not provided.") {
          res.redirect('/logout')
        }

        res.locals.profile.exists = true
        next();
      });

    }).on('error', function(err) {
        next(err)
    });
  }
  else {
    next()
  }
}

async function convertCodeToToken(req, res, next) {
  var theCode = req.query.code;

  var options = {
      'code': theCode,
      'redirect_uri': ion_redirect_uri,
      'scope': 'read'
   };

  try {
      var accessToken = await client.getToken(options);
      res.locals.token = accessToken.token;
      next()
  }
  catch (error) {
      console.log('Access Token Error', error.message);
       res.send(502);
  }
}

var pool = mysql.createPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE
})
var STATS = [["workload", "", "<="], ["difficulty","","<="], ["enjoyment", "DESC", ">="], ["teacher_score", "DESC", ">="], ["grade", "DESC", ">="]]

function get_class_info(req, res, next) {
  console.log('SELECT * FROM classes WHERE id="' + req.params.classID + '";')
  pool.query('SELECT * FROM classes WHERE id="' + req.params.classID + '";', function(error, results) {
    if (error) res.render('error');
    try {
      if (results.length != 1) {
        res.render('error')
      }
      else {
        res.locals.results = results[0]
        next()
      }
    } catch (error) {
      console.log(error)
      res.render('error')
    }
  })
}

function get_score_rank(req, res, next) {
  if (res.locals.results.total == 0) {
    res.render('classes', {"class_info": res.locals.results, "login_link": authorizationUri})
  }
  else {
    pool.query('SELECT name, RANK() OVER (ORDER BY class_score desc) ranking, total FROM classes WHERE class_score >= ' + res.locals.results.class_score + ' AND total > 0 ORDER BY ranking', function(e,r) {
      res.locals.results.class_score_rank = r[r.length-1].ranking
      next()
    })
  }
}

function get_total_classes(req, res, next) {
  pool.query('SELECT * FROM classes WHERE total > 0', function(e,r) {
    res.locals.results.num_classes = r.length
    next()
  })
}

function score_category(req, res, next) {
  // console.log(res.locals.results.class_score)
  pool.query('SELECT name, RANK() OVER (ORDER BY class_score desc) ranking, total FROM classes WHERE class_score >= ' + res.locals.results.class_score + ' AND total > 0 AND category="' + res.locals.results.category + '" ORDER BY ranking', function(e,r) {
    res.locals.results.class_score_category_rank = r[r.length-1].ranking
    next()
  })
}

function num_category(req, res, next) {
  pool.query('SELECT * FROM classes WHERE category="' + res.locals.results.category + '" AND total > 0;', function(e,r) {
    res.locals.results.num_category = r.length
    next()
  })
}

function avg_terms(req, res, next) {
  pool.query('SELECT term, term_order, AVG(class_score) AS avg_score, AVG(workload) AS avg_workload, AVG(difficulty) AS avg_difficulty, AVG(enjoyment) AS avg_enjoyment, AVG(teacher_score) AS avg_teacher_score, AVG(grade) AS avg_grade, COUNT(*) AS total FROM class_' + res.locals.results.id + ' GROUP BY term;', function(e,r) {
    res.locals.term_to_index = {}
    for (var i = 0; i < r.length; i++) {
      res.locals.term_to_index[r[i].term] = i
    }
    res.locals.term_stats = r
    next()
  })
}

function total_grade(req, res, next) {
  pool.query('SELECT * FROM classes WHERE grade > 0;', function(e,r) {
    res.locals.results.num_grade = r.length
    next()
  })
}

function grade_num(req, res, next) {
  pool.query('SELECT term, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY term;', function(e,r) {
    var total = 0
    for (var i = 0; i < r.length; i++) {
      res.locals.term_stats[res.locals.term_to_index[r[i].term]].grade_total = r[i].total
      total += r[i].total
    }
    res.locals.term_stats[res.locals.term_stats.length-1].grade_total = total
    next()
  })
}

function get_feedback(req, res, next) {
  pool.query('SELECT * FROM class_' + res.locals.results.id + ' WHERE NOT (feedback="");', function(e,r) {
    res.locals.feedback = r
    next()
  })
}

function median_score(req, res, next) {
  pool.query('SELECT term, class_score, ROW_NUMBER() OVER(PARTITION BY term ORDER BY class_score DESC) AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
    // console.log(res.locals.term_to_index)
    var curr_ind = 0
    while (curr_ind < r.length) {
      var curr_term = r[curr_ind].term
      var total_nums = res.locals.term_stats[res.locals.term_to_index[curr_term]].total

      if (total_nums % 2 == 0) {
        res.locals.term_stats[res.locals.term_to_index[curr_term]].med_score = (r[curr_ind + Math.floor(total_nums/2)].class_score + r[(curr_ind + Math.floor(total_nums/2))-1].class_score) / 2
      }
      else {
        res.locals.term_stats[res.locals.term_to_index[curr_term]].med_score = r[curr_ind + Math.floor(total_nums/2)].class_score
      }

      curr_ind += total_nums
    }
    next()
  })
}

function avg_overall(req, res, next) {
  pool.query('SELECT term, AVG(class_score) AS avg_score, AVG(workload) AS avg_workload, AVG(difficulty) AS avg_difficulty, AVG(enjoyment) AS avg_enjoyment, AVG(teacher_score) AS avg_teacher_score, AVG(grade) AS avg_grade, COUNT(*) AS total FROM class_' + res.locals.results.id + ';', function(e,r) {
    var add = r[0]
    add.term = "Overall"
    add.term_order = 9999
    res.locals.term_stats.push(add)
    next()
  })
}

function median_overall_score(req, res, next) {
  pool.query('SELECT term, class_score, ROW_NUMBER() OVER(ORDER BY class_score DESC) AS row_num FROM class_' + res.locals.results.id + ';', function(e,r) {
    if (r.length > 0) {
      if (r.length % 2 == 0) {
        res.locals.term_stats[res.locals.term_stats.length-1].med_score = (r[Math.floor(r.length/2)].class_score + r[Math.floor(r.length/2)-1].class_score) / 2
      }
      else {
        res.locals.term_stats[res.locals.term_stats.length-1].med_score = r[Math.floor(r.length/2)].class_score
      }
    }
    next()
  })
}

// SELECT teacher, term, class_score, ROW_NUMBER() OVER(PARTITION BY teacher,term ORDER BY class_score) AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_2340T1;
function teacher_class_score(req, res, next) {
  pool.query('SELECT teacher, term, term_order, class_score, ROW_NUMBER() OVER(PARTITION BY teacher,term ORDER BY class_score) AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_' + res.locals.results.id, function(e, r) {
    if (r.length > 0) {
      res.locals.teacher_to_index = {}
      var curr_index = 0
      var curr_teacher = r[0].teacher
      var curr_len = 0
      var dict_index = 0
      res.locals.term_teacher_to_index = {}
      res.locals.term_teacher_to_index[curr_teacher] = {}

      var curr_term = r[0].term
      var curr_term_len = 0
      var curr_term_index = 0
      var term_index = 0

      res.locals.teachers = [{"name": curr_teacher, "terms": []}]
      for (var i = 0; i < r.length; i++) {
        if (!(curr_term === r[i].term && curr_teacher === r[i].teacher)) {
          res.locals.term_teacher_to_index[curr_teacher][curr_term] = term_index
          if (curr_term_len % 2 == 0) {
            res.locals.teachers[dict_index].terms.push({"term": curr_term, "term_order": r[i-1].term_order, "total": curr_term_len, "class_score": (r[curr_term_index + Math.floor(curr_term_len/2)].class_score + r[curr_term_index + Math.floor(curr_term_len/2)-1].class_score) / 2})
          }
          else {
            res.locals.teachers[dict_index].terms.push({"term": curr_term, "term_order": r[i-1].term_order, "total": curr_term_len, "class_score": r[curr_term_index + Math.floor(curr_term_len/2)].class_score})
          }

          curr_term_len = 0
          curr_term_index = i
          curr_term = r[i].term
          term_index += 1
        }
        if (!(curr_teacher === r[i].teacher)) {
          res.locals.teacher_to_index[curr_teacher] = dict_index

          curr_len = 0
          curr_index = i
          dict_index += 1
          curr_teacher = r[i].teacher
          res.locals.teachers.push({"name": curr_teacher, "terms": []})
          res.locals.term_teacher_to_index[curr_teacher] = {}
          term_index = 0
        }
        curr_len += 1
        curr_term_len += 1
      }
      res.locals.teacher_to_index[curr_teacher] = dict_index
      res.locals.term_teacher_to_index[curr_teacher][curr_term] = term_index
      if (curr_term_len % 2 == 0) {
        res.locals.teachers[dict_index].terms.push({"term": curr_term, "term_order": r[r.length-1].term_order, "total": curr_term_len, "class_score": (r[curr_term_index + Math.floor(curr_term_len/2)].class_score + r[curr_term_index + Math.floor(curr_term_len/2)-1].class_score) / 2})
      }
      else {
        res.locals.teachers[dict_index].terms.push({"term": curr_term, "term_order": r[r.length-1].term_order, "total": curr_term_len, "class_score": r[curr_term_index + Math.floor(curr_term_len/2)].class_score})
      }
    }
    next()
  })
}

function overall_teacher_score(req, res, next) {
  pool.query('SELECT teacher, term, class_score, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY class_score) AS row_term FROM class_' + res.locals.results.id + ';', function(e, r) {
    if (r.length > 0) {
      var curr_index = 0
      var curr_teacher = r[curr_index].teacher
      while (curr_index < r.length) {
        curr_teacher = r[curr_index].teacher
        var total = 0
        for (var i = 0; i < res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length; i++) {
          total += res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[i].total
        }

        if (total % 2 == 0) {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.push({"term": "Overall", "term_order": 9999, "total": total, "class_score": (r[curr_index + Math.floor(total/2)].class_score + r[curr_index + Math.floor(total/2)-1].class_score) / 2})
        }
        else {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.push({"term": "Overall", "term_order": 9999, "total": total, "class_score": r[curr_index + Math.floor(total/2)].class_score})
        }

        curr_index += total
      }
    }
    next()
  })
}

//////// GENERIC CODE STARTS HERE
function get_stat_rank(stat, desc, arrow) {
  return function(req, res, next) {
    pool.query('SELECT name, RANK() OVER (ORDER BY ' + stat + ' ' + desc + ') ranking, total FROM classes WHERE ' + stat + ' ' + arrow + ' ' + res.locals.results[stat] + ' AND total > 0 ORDER BY ranking', function(e,r) {
      if (r.length == 0) {
        res.locals.results[stat + "_rank_null"] = true
        next()
      }
      else {
        res.locals.results[stat + "_rank"] = r[r.length-1].ranking
        next()
      }
    })
  }
}

function stat_category(stat, desc, arrow) {
  return function(req, res, next) {
    pool.query('SELECT name, RANK() OVER (ORDER BY ' + stat + ' ' + desc + ') ranking, total FROM classes WHERE ' + stat + ' ' + arrow + ' ' + res.locals.results[stat] + ' AND category="' + res.locals.results.category + '" AND total > 0 ORDER BY ranking', function(e,r) {
      if (r.length == 0) {
        res.locals.results[stat + "_rank_null"] = true
        next()
      }
      else {
        res.locals.results[stat + "_category_rank"] = r[r.length-1].ranking
        next()
      }
    })
  }
}

function median_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY term ORDER BY ' + stat + ') AS row_num FROM class_' + res.locals.results.id + ' WHERE ' + stat + ' IS NOT NULL;', function(e,r) {
      var curr_ind = 0
      while (curr_ind < r.length) {
        var curr_term = r[curr_ind].term
        var total_nums = res.locals.term_stats[res.locals.term_to_index[curr_term]].total
        if (stat == "grade") {
          total_nums = res.locals.term_stats[res.locals.term_to_index[curr_term]].grade_total
        }

        if (total_nums % 2 == 0) {
          res.locals.term_stats[res.locals.term_to_index[curr_term]]["med_" + stat] = (r[curr_ind + Math.floor(total_nums/2)][stat] + r[(curr_ind + Math.floor(total_nums/2))-1][stat]) / 2
        }
        else {
          res.locals.term_stats[res.locals.term_to_index[curr_term]]["med_" + stat] = r[curr_ind + Math.floor(total_nums/2)][stat]
        }

        curr_ind += total_nums
      }
      next()
    })
  }
}

function teacher_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT teacher, term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY teacher, term ORDER BY ' + stat + ') AS row_term, ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY term) AS row_teacher FROM class_' + res.locals.results.id + ' WHERE ' + stat + ' IS NOT NULL;', function(e, r) {
      if (r.length > 0) {
        var curr_index = 0
        var curr_teacher = r[0].teacher
        var curr_len = 0

        var curr_term = r[0].term
        var curr_term_len = 0
        var curr_term_index = 0

        for (var i = 0; i < r.length; i++) {
          if (!(curr_term === r[i].term && curr_teacher === r[i].teacher)) {
            if (curr_term_len % 2 == 0) {
              res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = (r[curr_term_index + Math.floor(curr_term_len/2)][stat] + r[curr_term_index + Math.floor(curr_term_len/2)-1][stat]) / 2
            }
            else {
              res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = r[curr_term_index + Math.floor(curr_term_len/2)][stat]
            }

            curr_term_len = 0
            curr_term_index = i
            curr_term = r[i].term
          }
          if (!(curr_teacher === r[i].teacher)) {
            curr_len = 0
            curr_index = i
            curr_teacher = r[i].teacher
          }
          curr_len += 1
          curr_term_len += 1
        }
        if (curr_term_len % 2 == 0) {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = (r[curr_term_index + Math.floor(curr_term_len/2)][stat] + r[curr_term_index + Math.floor(curr_term_len/2)-1][stat]) / 2
        }
        else {
          res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.term_teacher_to_index[curr_teacher][curr_term]][stat] = r[curr_term_index + Math.floor(curr_term_len/2)][stat]
        }
      }
      next()
    })
  }
}

function overall_teacher_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT teacher, term, ' + stat + ', ROW_NUMBER() OVER(PARTITION BY teacher ORDER BY ' + stat + ') AS row_term FROM class_' + res.locals.results.id + ' WHERE ' + stat + ' IS NOT NULL;', function(e, r) {
      if (r.length > 0) {
        var curr_index = 0
        var curr_teacher = r[curr_index].teacher
        while (curr_index < r.length) {
          curr_teacher = r[curr_index].teacher
          var total = 0
          for (var i = 0; i < res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1; i++) {
            if (stat == "grade") {
              total += res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[i].grade_total
            }
            else {
              total += res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[i].total
            }

          }

          if (total % 2 == 0) {
            res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1][stat] = (r[curr_index + Math.floor(total/2)][stat] + r[curr_index + Math.floor(total/2)-1][stat]) / 2
          }
          else {
            res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[curr_teacher]].terms.length-1][stat] = r[curr_index + Math.floor(total/2)][stat]
          }

          curr_index += total
        }
      }
      next()
    })
  }
}

function median_overall_stat(stat) {
  return function(req, res, next) {
    pool.query('SELECT term, ' + stat + ', ROW_NUMBER() OVER(ORDER BY ' + stat + ') AS row_num FROM class_' + res.locals.results.id + ' WHERE ' + stat + ' IS NOT NULL;', function(e,r) {
      if (r.length > 0) {
        if (r.length % 2 == 0) {
          res.locals.term_stats[res.locals.term_stats.length-1]["med_" + stat] = (r[Math.floor(r.length/2)][stat] + r[Math.floor(r.length/2)-1][stat]) / 2
        }
        else {
          res.locals.term_stats[res.locals.term_stats.length-1]["med_" + stat] = r[Math.floor(r.length/2)][stat]
        }
      }
      next()
    })
  }
}

// function do_stats_functions(req, res, next) {
//   for (var i = 0; i < STATS.length; i++) {
//     get_stat_rank(STATS[i][0], STATS[i][1], STATS[i][2])
//     stat_category(STATS[i][0], STATS[i][1], STATS[i][2])
//     median_stat(STATS[i][0])
//     teacher_stat(STATS[i][0])
//     overall_teacher_stat(STATS[i][0])
//     median_overall_stat(STATS[i][0])
//   }
//   next()
// }

//////// GENERIC CODE ENDS HERE

function teacher_grade_num(req, res, next) {
  pool.query('SELECT teacher, term, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY term, teacher;', function(e ,r) {
    for (var i = 0; i < res.locals.teachers.length; i++) {
      for (var j = 0; j < res.locals.teachers[i].terms.length; j++) {
        res.locals.teachers[i].terms[j].grade_total = 0
      }
    }
    if (r.length > 0) {
      for (var i = 0; i < r.length; i++) {
        res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms[res.locals.term_teacher_to_index[r[i].teacher][r[i].term]].grade_total = r[i].total
      }
    }
    next()
  })
}

function teacher_grade_num_overall(req, res, next) {
  pool.query('SELECT teacher, COUNT(*) AS total FROM class_' + res.locals.results.id + ' WHERE grade >= 0 GROUP BY teacher;', function(e ,r) {
    if (r.length > 0) {
      for (var i = 0; i < r.length; i++) {
        res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms[res.locals.teachers[res.locals.teacher_to_index[r[i].teacher]].terms.length-1].grade_total = r[i].total
      }
    }
    next()
  })
}

function get_class_list(req, res, next) {
  pool.query('SELECT name, alt, id FROM classes;', function(e, r) {
    res.locals.class_list = r
    next()
  })
}

function get_user_feedback(req, res, next) {
  // console.log('SELECT userfeedback.*, classes.name FROM userfeedback INNER JOIN classes ON userfeedback.class_id = classes.id WHERE user_id=' + res.locals.profile.id + ';')
  pool.query('SELECT userfeedback.*, classes.name, classes.id FROM userfeedback INNER JOIN classes ON userfeedback.class_id = classes.id WHERE user_id=' + res.locals.profile.id + ';', function(e,r) {
    res.locals.review_term = {}
    for (var i = 0; i < r.length; i++) {
      var year = r[i].term
      if (!(year.indexOf(' ') == -1)) {
        if (!(year.indexOf('Spring') == -1)) {
          var second_year = parseInt(year.substring(year.indexOf(' ')+1))
          year = "20"+(second_year-1) + "-" + second_year
        }
        else {
          var first_year = parseInt(year.substring(year.indexOf(' ')+1))
          year = "20"+first_year + "-" + (first_year+1)
        }
      }
      if (!(year in res.locals.review_term)) {
        res.locals.review_term[year] = {"term": year, "reviews": []}
      }
      res.locals.review_term[year].reviews.push(r[i])
    }
    next()
  })
}

function get_classes(req, res, next) {
  pool.query('SELECT name, alt, id, length FROM classes;', function(e, r) {
    res.locals.classes = r
    next()
  })
}

var TERMS_YR = ["Summer 18", "2018-19", "Summer 19", "2019-20", "Summer 20", "2020-21", "Summer 21", "2021-22"]
var TERMS_SEM = ["Summer 18", "Fall 18", "Spring 19", "Summer 19", "Fall 19", "Spring 20", "Summer 20", "Fall 20", "Spring 21", "Summer 21", "Fall 21", "Spring 22"]

function submit_class_feedback(req, res, next) {
  var class_name = req.body.class_name
  var class_id = req.body.class_id
  var term = req.body.term
  var teacher = req.body.teacher
  var class_score = parseFloat(req.body.class_score)
  var workload = parseFloat(req.body.workload)
  var difficulty = parseFloat(req.body.difficulty)
  var enjoyment = parseFloat(req.body.enjoyment)
  var teacher_score = parseFloat(req.body.teacher_score)
  var show_teacher = req.body.show_teacher == "on" ? true : false
  var grade = req.body.grade
  var feedback = req.body.feedback

  feedback = feedback.trim()
  if (!(feedback == ""))
    feedback = filter.clean(feedback)

  var grade_input = 0
  if (grade.length > 5) {
    grade = grade.substring(0, 5)
  }

  if (grade == "") {
    grade_input = "NULL"
    grade = "NULL"
  }
  else {
    if (isNaN(grade)) {
      grade = grade.toUpperCase()
      switch (grade) {
        case "A":
          grade_input = 95
          break
        case "A-":
          grade_input = 91
          break
        case "B+":
          grade_input = 88
          break
        case "B":
          grade_input = 85
          break
        case "B-":
          grade_input = 81
          break
        case "C+":
          grade_input = 78
          break
        case "C":
          grade_input = 75
          break
        case "C-":
          grade_input = 71
          break
        case "D+":
          grade_input = 68
          break
        case "D":
          grade_input = 65
          break
        case "F":
          grade_input = 60
          break
      }
    }
    else {
      grade_input = parseFloat(grade)
    }
  }

  var term_order = 0
  // console.log(term.indexOf(' '))
  if (term.indexOf(' ') == -1) {
    for (var i = 0; i < TERMS_YR.length; i++) {
      if (TERMS_YR[i] == term) {
        term_order = i+1
        break;
      }
    }
  }
  else {
    for (var i = 0; i < TERMS_SEM.length; i++) {
      if (TERMS_SEM[i] == term) {
        term_order = i+1
        break;
      }
    }
  }

  if (grade == "NULL") {
    // console.log('INSERT INTO class_' + class_id + ' VALUES (' + res.locals.profile.id + ', NOW(), "' + term + '", "' + teacher + '", ' + class_score  + ', ' + workload + ', "' + feedback + '", 0, ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', NULL, ' + show_teacher + ', NULL, ' + term_order + ');')
    // console.log('INSERT INTO userfeedback VALUES (' + res.locals.profile.id + ', "' + res.locals.profile.ion_username + '", "' + class_id + '", NOW(), "' + term + '", "' + teacher + '", ' + class_score + ', ' + workload + ', "' + feedback + '", ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', NULL, ' + show_teacher + ', NULL, NULL);')
    pool.query('INSERT INTO class_' + class_id + ' VALUES (' + res.locals.profile.id + ', NOW(), "' + term + '", "' + teacher + '", ' + class_score  + ', ' + workload + ', "' + feedback + '", 0, ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', NULL, ' + show_teacher + ', NULL, ' + term_order + ');', function(e, r) {
      // console.log(e, r)
      pool.query('INSERT INTO userfeedback VALUES (' + res.locals.profile.id + ', "' + res.locals.profile.ion_username + '", "' + class_id + '", NOW(), "' + term + '", "' + teacher + '", ' + class_score + ', ' + workload + ', "' + feedback + '", ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', NULL, ' + show_teacher + ', NULL, NULL);', function(e, r) {
        // console.log(e, r)
        res.locals.class_median = {}
        next()
      })
    })
  }
  else {
    // console.log('INSERT INTO class_' + class_id + ' VALUES (' + res.locals.profile.id + ', NOW(), "' + term + '", "' + teacher + '", ' + class_score  + ', ' + workload + ', "' + feedback + '", 0, ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', ' + grade_input + ', ' + show_teacher + ', NULL, ' + term_order + ');')
    // console.log('INSERT INTO userfeedback VALUES (' + res.locals.profile.id + ', "' + res.locals.profile.ion_username + '", "' + class_id + '", NOW(), "' + term + '", "' + teacher + '", ' + class_score + ', ' + workload + ', "' + feedback + '", ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', ' + grade_input + ', ' + show_teacher + ', "' + grade + '", NULL);')
    pool.query('INSERT INTO class_' + class_id + ' VALUES (' + res.locals.profile.id + ', NOW(), "' + term + '", "' + teacher + '", ' + class_score  + ', ' + workload + ', "' + feedback + '", 0, ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', ' + grade_input + ', ' + show_teacher + ', NULL, ' + term_order + ');', function(e, r) {
      pool.query('INSERT INTO userfeedback VALUES (' + res.locals.profile.id + ', "' + res.locals.profile.ion_username + '", "' + class_id + '", NOW(), "' + term + '", "' + teacher + '", ' + class_score + ', ' + workload + ', "' + feedback + '", ' + difficulty + ', ' + enjoyment + ', ' + teacher_score + ', ' + grade_input + ', ' + show_teacher + ', "' + grade + '", NULL);', function(e, r) {
        res.locals.class_median = {}
        next()
      })
    })
  }
}

function edit_class_feedback(req, res, next) {
  res.locals.class_median = {}
  var class_name = req.body.class_name
  var class_id = req.body.class_id
  var original_term = req.body.original_term
  var term = req.body.term
  var teacher = req.body.teacher
  var class_score = parseFloat(req.body.class_score)
  var workload = parseFloat(req.body.workload)
  var difficulty = parseFloat(req.body.difficulty)
  var enjoyment = parseFloat(req.body.enjoyment)
  var teacher_score = parseFloat(req.body.teacher_score)
  var show_teacher = req.body.show_teacher == "on" ? true : false
  var grade = req.body.grade
  var feedback = req.body.feedback
  var delete_feedback = req.body.delete_feedback
  var original_term = req.body.original_term

  feedback = feedback.trim()
  console.log(feedback)
  if (!(feedback == ""))
    feedback = filter.clean(feedback)

  var grade_input = 0
  if (grade.length > 5) {
    grade = grade.substring(0, 5)
  }

  if (grade == "") {
    grade_input = "NULL"
    grade = "NULL"
  }
  else {
    if (isNaN(grade)) {
      grade = grade.toUpperCase()
      switch (grade) {
        case "A":
          grade_input = 95
          break
        case "A-":
          grade_input = 91
          break
        case "B+":
          grade_input = 88
          break
        case "B":
          grade_input = 85
          break
        case "B-":
          grade_input = 81
          break
        case "C+":
          grade_input = 78
          break
        case "C":
          grade_input = 75
          break
        case "C-":
          grade_input = 71
          break
        case "D+":
          grade_input = 68
          break
        case "D":
          grade_input = 65
          break
        case "F":
          grade_input = 60
          break
      }
    }
    else {
      grade_input = parseFloat(grade)
    }
  }

  var term_order = 0
  if (term.indexOf(' ') == -1) {
    for (var i = 0; i < TERMS_YR.length; i++) {
      if (TERMS_YR[i] == term) {
        term_order = i+1
        break;
      }
    }
  }
  else {
    for (var i = 0; i < TERMS_SEM.length; i++) {
      if (TERMS_SEM[i] == term) {
        term_order = i+1
        break;
      }
    }
  }

  if (delete_feedback == 1) {
    pool.query('DELETE FROM userfeedback WHERE class_id="' + class_id + '" AND user_id=' + res.locals.profile.id + ' AND term="' + original_term + '";', function(e, r) {
      pool.query('DELETE FROM class_' + class_id + ' WHERE user_id=' + res.locals.profile.id + ' AND term="' + original_term + '";', function(e, r) {
        next()
      })
    })
  }
  else {
    if (grade == "NULL") {
      pool.query('UPDATE userfeedback SET term="' + term + '", teacher="' + teacher + '", class_score=' + class_score + ', workload=' + workload + ', difficulty=' + difficulty + ', enjoyment=' + enjoyment + ', teacher_score=' + teacher_score + ', show_teacher=' + show_teacher + ', grade=NULL, grade_input=NULL, feedback="' + feedback + '", edit_time=NOW() WHERE class_id="' + class_id + '" AND user_id=' + res.locals.profile.id + ' AND term="' + original_term + '";', function(e, r) {
        pool.query('UPDATE class_' + class_id + ' SET term="' + term + '", teacher="' + teacher + '", class_score=' + class_score + ', workload=' + workload + ', difficulty=' + difficulty + ', enjoyment=' + enjoyment + ', teacher_score=' + teacher_score + ', show_teacher=' + show_teacher + ', grade=NULL, term_order="' + term_order + '", feedback="' + feedback + '", edit_time=NOW(), edited=1 WHERE user_id=' + res.locals.profile.id + ' AND term="' + original_term + '";', function(e, r) {
          // console.log(e)
          next()
        })
      })
    }
    else {
      pool.query('UPDATE userfeedback SET term="' + term + '", teacher="' + teacher + '", class_score=' + class_score + ', workload=' + workload + ', difficulty=' + difficulty + ', enjoyment=' + enjoyment + ', teacher_score=' + teacher_score + ', show_teacher=' + show_teacher + ', grade=' + grade_input + ', grade_input="' + grade + '", feedback="' + feedback + '", edit_time=NOW() WHERE class_id="' + class_id + '" AND user_id=' + res.locals.profile.id  + ' AND term="' + original_term + '";', function(e, r) {
        pool.query('UPDATE class_' + class_id + ' SET term="' + term + '", teacher="' + teacher + '", class_score=' + class_score + ', workload=' + workload + ', difficulty=' + difficulty + ', enjoyment=' + enjoyment + ', teacher_score=' + teacher_score + ', show_teacher=' + show_teacher + ', grade=' + grade_input + ', term_order="' + term_order + '", feedback="' + feedback + '", edit_time=NOW(), edited=1 WHERE user_id=' + res.locals.profile.id + ' AND term="' + original_term + '";', function(e, r) {
          // console.log(e)
          next()
        })
      })
    }
  }
}

function update_tables(stat) {
  return function(req, res, next) {
    pool.query('SELECT ' + stat + ', ROW_NUMBER() OVER(ORDER BY ' + stat + ') AS row_num FROM class_' + req.body.class_id + ';', function(e, r) {
      if (r.length == 0) {
        res.locals.class_median[stat] = 'NULL'
      }
      else {
        if (r.length % 2 == 0) {
          res.locals.class_median[stat] = (r[Math.floor(r.length/2)][stat] + r[Math.floor(r.length/2)-1][stat]) / 2
        }
        else {
          res.locals.class_median[stat] = r[Math.floor(r.length / 2)][stat]
        }
      }

      pool.query('UPDATE classes SET ' + stat + '=' + res.locals.class_median[stat] + ' WHERE id="' + req.body.class_id + '";', function(e, r) {
        next()
      })
    })
  }
}

function update_tables_grade(req, res, next) {
  pool.query('SELECT grade, ROW_NUMBER() OVER(ORDER BY grade) AS row_num FROM class_' + req.body.class_id + ' WHERE grade IS NOT NULL;', function(e, r) {
    if (r.length == 0) {
      res.locals.class_median.grade = 'NULL'
    }
    else {
      if (r.length % 2 == 0) {
        res.locals.class_median.grade = (r[Math.floor(r.length/2)].grade + r[Math.floor(r.length/2)-1].grade) / 2
      }
      else {
        res.locals.class_median.grade = r[Math.floor(r.length / 2)].grade
      }
    }

    pool.query('UPDATE classes SET grade=' + res.locals.class_median.grade + ' WHERE id="' + req.body.class_id + '";', function(e, r) {
      // console.log(e)
      next()
    })
  })
}

function update_tables_total(req, res, next) {
  pool.query('SELECT COUNT(*) AS total FROM class_' + req.body.class_id + ';', function(e, r) {
    // console.log(r[0].total)
    pool.query('UPDATE classes SET total=' + r[0].total + ' WHERE id="' + req.body.class_id + '";', function (e, r) {
      next()
    })
  })
}

function update_tables_grade_total(req, res, next) {
  pool.query('SELECT COUNT(*) AS total FROM class_' + req.body.class_id + ' WHERE grade >= 0;', function(e, r) {
    // console.log(r[0].total)
    pool.query('UPDATE classes SET grade_inputs=' + r[0].total + ' WHERE id="' + req.body.class_id + '";', function (e, r) {
      next()
    })
  })
}

app.get('/login_worker', [convertCodeToToken], function(req, res) {
  req.session.authenticated = true;
  req.session.token = res.locals.token;

  res.redirect('/');
})

app.get('/logout', function (req, res) {
  delete req.session.authenticated;

  res.redirect('/');
})

var base_middleware = [get_class_info, get_total_classes, num_category, total_grade, avg_terms, avg_overall, grade_num, get_feedback]
var score_middleware = [get_score_rank, score_category, median_score, teacher_class_score, overall_teacher_score, median_overall_score]
var workload_middleware = [get_stat_rank("workload", "", "<="), stat_category("workload", "", "<="), median_stat("workload"), teacher_stat("workload"), overall_teacher_stat("workload"), median_overall_stat("workload")]
var difficulty_middleware = [get_stat_rank("difficulty", "", "<="), stat_category("difficulty", "", "<="), median_stat("difficulty"), teacher_stat("difficulty"), overall_teacher_stat("difficulty"), median_overall_stat("difficulty")]
var enjoyment_middleware = [get_stat_rank("enjoyment", "DESC", ">="), stat_category("enjoyment", "DESC", ">="), median_stat("enjoyment"), teacher_stat("enjoyment"), overall_teacher_stat("enjoyment"), median_overall_stat("enjoyment")]
var teacher_score_middleware = [get_stat_rank("teacher_score", "DESC", ">="), stat_category("teacher_score", "DESC", ">="), median_stat("teacher_score"), teacher_stat("teacher_score"), overall_teacher_stat("teacher_score"), median_overall_stat("teacher_score")]
var grade_middleware = [get_stat_rank("grade", "DESC", ">="), stat_category("grade", "DESC", ">="), median_stat("grade"), teacher_stat("grade"), overall_teacher_stat("grade"), median_overall_stat("grade")]
var extra_grade_middleware = [teacher_grade_num, teacher_grade_num_overall]
var stats_middleware = workload_middleware.concat(difficulty_middleware).concat(enjoyment_middleware).concat(teacher_score_middleware)

// document.getElementById('ice-cream-choice').setAttribute('list', "ice-cream-flavors")

app.get('/', [getProfileData], (req, res) => {
  pool.query("SELECT * FROM classes;", function(error, results) {
    console.log(res.locals.profile)
    res.render('index', {"classes": results, "profile": res.locals.profile, "login_link": authorizationUri})
  })
})

app.get('/class/:classID', [getProfileData].concat(base_middleware).concat(score_middleware).concat(stats_middleware).concat(extra_grade_middleware).concat(grade_middleware), function (req, res) {
  // console.log(res.locals.results)
  // console.log(res.locals.term_stats)
  // console.log(res.locals.teachers)
  console.log(res.locals.feedback)
  var feedback = []
  for (const [key, value] of Object.entries(res.locals.feedback)) {
    feedback.push(value)
  }
  feedback.sort((a, b) => (a.term < b.term) ? 1 : -1)
  res.render('classes', {"class_info": res.locals.results, "term_stats": res.locals.term_stats, "teacher": res.locals.teachers, "feedback": feedback, "profile": res.locals.profile, "login_link": authorizationUri})
})

app.get('/profile', [checkAuthentication, getProfileData, get_user_feedback, get_classes], (req, res) => {
  // console.log(res.locals.review_term)
  // console.log(res.locals.classes)
  var reviews = []
  for (const [key, value] of Object.entries(res.locals.review_term)) {
    reviews.push(value)
  }
  reviews.sort((a, b) => (a.term < b.term) ? 1 : -1)
  // console.log(reviews)
  res.render('profile_page', {"profile": res.locals.profile, "reviews": reviews, "classes": res.locals.classes, "terms": TERMS})
})

app.post('/submit_feedback', [checkAuthentication, getProfileData, submit_class_feedback, update_tables("class_score"), update_tables("workload"), update_tables("difficulty"), update_tables("enjoyment"), update_tables("teacher_score"), update_tables_grade, update_tables_total, update_tables_grade_total], (req, res) => {
  res.redirect('/profile')
})

app.post('/edit_feedback', [checkAuthentication, getProfileData, edit_class_feedback, update_tables("class_score"), update_tables("workload"), update_tables("difficulty"), update_tables("enjoyment"), update_tables("teacher_score"), update_tables_grade, update_tables_total, update_tables_grade_total], (req, res) => {
  res.redirect('/profile')
})

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
})
