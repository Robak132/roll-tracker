// Whenever a chat message is created, check if it contains a roll. If so, parse it to determine
// whether it should be tracked, according to our module settings
Hooks.on('updateChatMessage', async (chatMessage) => {
  const isBlind = chatMessage.blind
  if (!isBlind || (isBlind && game.settings.get('roll-tracker', 'count_hidden')) || (isBlind && chatMessage.user.isGM)) {
    await RollTrackerData.saveTrackedRoll(chatMessage.user.id, chatMessage.flags.testData)
  }
})

// This adds our icon to the player list
Hooks.on('renderPlayerList', (playerList, html) => {
  if (game.user.isGM) {
    if (game.settings.get('roll-tracker', 'gm_see_players')) {
      // This adds our icon to ALL players on the player list, if the setting is toggled
      const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')
      // create the button where we want it to be
      for (let user of game.users) {
        const buttonPlacement = html.find(`[data-user-id="${user.id}"]`)
        buttonPlacement.append(`<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${user.id}"><i class="fas fa-dice-d20"></i></button>`)
        html.on('click', `#${user.id}`, () => {
          new RollTrackerDialog(user.id).render(true);
        })
      }
    } else {
      // Put the roll tracker icon only beside the GM's name
      const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)
      const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')
      loggedInUser.append(`<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`)
      html.on('click', `#${game.userId}`, () => {
        new RollTrackerDialog(game.userId).render(true);
      })
    }
  } else if (game.settings.get('roll-tracker', 'players_see_players')) {
    // find the element which has our logged in user's id
    const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)
    const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')
    loggedInUser.append(`<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`)
    html.on('click', `#${game.userId}`, () => {
      new RollTrackerDialog(game.userId).render(true);
    })
  }
})

// Register our module with the Dev Mode module, for logging purposes
Hooks.once('devModeReady', ({registerPackageDebugFlag}) => {
  registerPackageDebugFlag('roll-tracker')
})

// Initialize dialog and settings on foundry boot up
Hooks.once('init', () => {
  // A setting to toggle whether the GM can see the icon allowing them access to player roll data or not
  game.settings.register('roll-tracker', 'gm_see_players', {
    name: `ROLL-TRACKER.settings.gm_see_players.Name`,
    default: true,
    type: Boolean,
    scope: 'world',
    config: true,
    hint: `ROLL-TRACKER.settings.gm_see_players.Hint`,
    onChange: () => ui.players.render()
  })

  // A setting to determine how many rolls should be stored at any one time
  game.settings.register('roll-tracker', 'roll_storage', {
    name: `ROLL-TRACKER.settings.roll_storage.Name`,
    default: 50,
    type: Number,
    range: {
      min: 10,
      max: 500,
      step: 10
    },
    scope: 'world',
    config: true,
    hint: `ROLL-TRACKER.settings.roll_storage.Hint`,
  })

  // A setting to determine whether players can see their own tracked rolls
  game.settings.register('roll-tracker', 'players_see_players', {
    name: `ROLL-TRACKER.settings.players_see_players.Name`,
    default: true,
    type: Boolean,
    scope: 'world',
    config: true,
    hint: `ROLL-TRACKER.settings.players_see_players.Hint`,
    onChange: () => ui.players.render()
  })

  // A setting to determine whether blind GM rolls that PLAYERS make are tracked
  // Blind GM rolls that GMs make are always tracked
  game.settings.register('roll-tracker', 'count_hidden', {
    name: `ROLL-TRACKER.settings.count_hidden.Name`,
    default: true,
    type: Boolean,
    scope: 'world',
    config: true,
    hint: `ROLL-TRACKER.settings.count_hidden.Hint`,
  })
})


class RollTrackerData {
  static flags = {
    SORTED: 'sorted',
    EXPORT: 'export',
    UNSORTED: 'unsorted',
  }

  static getUserRolls(userId) {
    return {
      user: game.users.get(userId),
      sorted: game.users.get(userId)?.getFlag('roll-tracker', this.flags.SORTED),
      unsorted: game.users.get(userId)?.getFlag('roll-tracker', this.flags.UNSORTED),
      export: game.users.get(userId)?.getFlag('roll-tracker', this.flags.EXPORT),
    }
  }

  static async saveTrackedRoll(userId, rollData) {
    if (game.userId === userId) {
      const maxTrackedRolls = game.settings.get('roll-tracker', 'roll_storage')
      const roll = {
        value: rollData.result.roll,
        success: rollData.result.outcome === "success",
        type: rollData.result.skillName
      }

      let oldSorted = this.getUserRolls(userId)?.sorted || []
      let oldUnsorted = this.getUserRolls(userId)?.unsorted || []
      if (oldUnsorted.length >= maxTrackedRolls) {
        const difference = oldUnsorted.length - maxTrackedRolls
        for (let i = 0; i <= difference; i++) {
          const popped = oldUnsorted.shift()
          const remove = oldSorted.findIndex((element) => {
            return element === popped
          })
          oldSorted.splice(remove, 1)
        }
      }

      if (oldSorted.length) {
        oldUnsorted.push(roll)
      } else {
        oldUnsorted = [roll]
      }
      return Promise.all([
        game.users.get(userId)?.setFlag('roll-tracker', this.flags.UNSORTED, oldUnsorted)
      ])
    }
  }

  static async clearTrackedRolls(userId) {
    return Promise.all([game.users.get(userId)?.unsetFlag('roll-tracker', this.flags.SORTED), game.users.get(userId)?.unsetFlag('roll-tracker', this.flags.EXPORT), game.users.get(userId)?.unsetFlag('roll-tracker', this.flags.UNSORTED),])
  }

  static prepareRollStats(userId) {
    const userRolls = this.getUserRolls(userId)
    const username = userRolls.user.name
    const rolls = userRolls.unsorted

    let stats = {}
    if (!rolls) {
      stats.mean = 0
      stats.median = 0
      stats.mode = [0]
      stats.modeCount = 0
      stats.autoSuccess = 0
      stats.autoSuccessPercentage = 0
      stats.autoFailure = 0
      stats.autoFailurePercentage = 0
      stats.count = 0
    } else {
      stats = this.calcStats(rolls)
    }

    return {
      username,
      userId,
      stats
    }
  }

  static calcStats(rolls) {
    const mean = calcAverage(rolls.map(r => r.value));
    const median = calcMedian(rolls.map(r => r.value));
    const {rollStats, mode, modeCount} = this.calcMode(rolls.map(r => r.value))
    const modeCountPercentage = (Math.round((modeCount / rolls.length) * 100))
    const autoSuccess = Object.entries(rollStats).reduce((acc, [key, value]) => {
      if (key <= game.settings.get("wfrp4e", "automaticSuccess")) return acc + value
      return acc
    }, 0)
    const autoSuccessPercentage = (Math.round((autoSuccess / rolls.length) * 100))
    const autoFailure = Object.entries(rollStats).reduce((acc, [key, value]) => {
      if (key >= game.settings.get("wfrp4e", "automaticFailure")) return acc + value
      return acc
    }, 0)
    const autoFailurePercentage = (Math.round((autoFailure / rolls.length) * 100))
    const lastRoll = rolls[rolls.length - 1].value
    const count = rolls.length

    this.prepareExportData(rollStats)

    return {
      mean,
      median,
      mode,
      modeCount,
      modeCountPercentage,
      autoSuccess,
      autoSuccessPercentage,
      autoFailure,
      autoFailurePercentage,
      lastRoll,
      count
    }
  }

  static calcMode(rolls) {
    let rollStats = {}
    let modeCount = 0
    let mode = []

    rolls.forEach(e => {
      if (!rollStats[e]) {
        rollStats[e] = 1
      } else {
        rollStats[e]++
      }
    })
    for (let rollNumber in rollStats) {
      if (rollStats[rollNumber] > modeCount) {
        modeCount = rollStats[rollNumber]
        mode.splice(0)
        mode.push(rollNumber)
      } else if (rollStats[rollNumber] === modeCount) {
        mode.push(rollNumber)
      }
    }

    return {
      rollStats,
      mode,
      modeCount
    }
  }

  static prepareExportData(data) {
    // prepare the roll data for export to an R-friendly text file
    const keys = Object.keys(data)
    let fileContent = ``
    for (let key of keys) {
      fileContent += `${key},${data[key]}\n`
    }
    // We store the filecontent on a flag on the user so it can be quickly accessed if the user
    // decides to click the export button on the RollTrackerDialog header
    game.users.get(game.userId)?.setFlag('roll-tracker', this.flags.EXPORT, fileContent)
  }

  /**
   * This function is meant to generate an overall picture across all players of rankings in the
   * various stats. Code exists to make the averages display alongside the individual player numbers
   * in the tracking card but I didn't like that
   **/
  static async generalComparison() {
    let allStats = {}
    for (let user of game.users) {
      if (game.users.get(user.id)?.getFlag('roll-tracker', this.flags.SORTED)) {
        const rolls = this.getUserRolls(user.id)?.unsorted
        allStats[`${user.id}`] = this.calcStats(rolls)
      }
    }

    const comparators = await this.statsCompare(allStats, 'comparator')
    const means = await this.statsCompare(allStats, 'mean')
    const medians = await this.statsCompare(allStats, 'median')
    const autoSuccess = await this.statsCompare(allStats, 'autoSuccess')
    const autoSuccessPercentage = await this.statsCompare(allStats, 'autoSuccessPercentage')
    const autoFailure = await this.statsCompare(allStats, 'autoFailure')
    const autoFailurePercentage = await this.statsCompare(allStats, 'autoFailurePercentage')
    let finalComparison = {}
    this.prepStats(finalComparison, 'mean', means, allStats)
    this.prepStats(finalComparison, 'median', medians, allStats)
    this.prepStats(finalComparison, 'autoSuccess', autoSuccess, allStats)
    this.prepStats(finalComparison, 'autoSuccessPercentage', autoSuccessPercentage, allStats)
    this.prepStats(finalComparison, 'autoFailure', autoFailure, allStats)
    this.prepStats(finalComparison, 'autoFailurePercentage', autoFailurePercentage, allStats)
    this.prepMode(finalComparison, 'comparator', comparators, allStats)

    return finalComparison
  }

  /**
   * A general function to compare incoming 'stats' using a specific data object in the format
   * generated in the allStats variable of generalComparison()
   */
  static async statsCompare(allStats, stat) {
    let topStat = -1;
    let comparison = {}
    for (let user in allStats) {
      if (allStats[`${user}`][stat] > topStat) {
        topStat = allStats[`${user}`][stat]
        comparison.top = [user]
      } else if (allStats[`${user}`][stat] === topStat) {
        comparison.top.push(user)
      }
    }

    if (stat !== 'comparator') {
      let botStat = 9999;
      for (let user in allStats) {
        if (allStats[`${user}`][stat] < botStat) {
          botStat = allStats[`${user}`][stat]
          comparison.bot = [user]
        } else if (allStats[`${user}`][stat] === botStat) {
          comparison.bot.push(user)
        }
      }

      let statSum = 0
      for (let user in allStats) {
        statSum += allStats[`${user}`][stat]
      }
      comparison.average = Math.round(statSum / (Object.keys(allStats).length))
    } else {
      topStat = -1;
      for (let user in allStats) {
        let percentage = Math.round(((allStats[`${user}`][stat]) / (allStats[`${user}`].count)) * 100)
        if (percentage > topStat) {
          topStat = percentage
          comparison.topPercentage = [user]
        } else if (percentage === topStat) {
          comparison.topPercentage.push(user)
        }
      }
    }

    return comparison
  }

  /**
   * A function preparing the output object of generalComparison (the obj is called finalComparison)
   * using previously calculated stats
   */
  static async prepStats(finalComparison, statName, statObj, allStats) {

    finalComparison[statName] = {}
    finalComparison[statName].highest = []
    finalComparison[statName].lowest = []

    for (let user of statObj.top) {
      const userStats = {}
      userStats.userId = `${user}`
      userStats.name = game.users.get(`${user}`)?.name
      userStats.value = allStats[`${user}`][statName]
      userStats.rolls = allStats[`${user}`].count
      finalComparison[statName].highest.push(userStats)
    }

    for (let user of statObj.bot) {
      const userStats = {}
      userStats.userId = `${user}`
      userStats.name = game.users.get(`${user}`)?.name
      userStats.value = allStats[`${user}`][statName]
      userStats.rolls = allStats[`${user}`].count
      finalComparison[statName].lowest.push(userStats)
    }

    finalComparison[statName].average = statObj.average
  }

  /**
   * Mode has its own way to be prepped as it can be multimodal etc
   */
  static async prepMode(finalComparison, comparator, comparators, allStats) {
    finalComparison[comparator] = {}
    finalComparison[comparator].highest = {}
    for (let user of comparators.top) {
      finalComparison[comparator].highest.userId = `${user}`
      finalComparison[comparator].highest.name = game.users.get(`${user}`)?.name
      const mode = allStats[`${user}`].mode
      let modeString = mode.join(', ')
      if (mode.length > 1) {
        const orPosn = modeString.lastIndexOf(',')
        const firstHalf = modeString.slice(0, orPosn)
        const secondHalf = modeString.slice(orPosn + 1)
        modeString = firstHalf.concat(' or', secondHalf)
      }
      finalComparison[comparator].highest.mode = modeString
      finalComparison[comparator].highest.value = allStats[`${user}`][comparator]
      finalComparison[comparator].highest.rolls = allStats[`${user}`].count
      finalComparison[comparator].highest.percentage = Math.round((((finalComparison[comparator].highest.value) / (finalComparison[comparator].highest.rolls))) * 100)
    }
    finalComparison[comparator].highestPercentage = {}
    for (let user of comparators.topPercentage) {
      finalComparison[comparator].highestPercentage.userId = `${user}`
      finalComparison[comparator].highestPercentage.name = game.users.get(`${user}`)?.name
      const mode = allStats[`${user}`].mode
      let modeString = mode.join(', ')
      if (mode.length > 1) {
        const orPosn = modeString.lastIndexOf(',')
        const firstHalf = modeString.slice(0, orPosn)
        const secondHalf = modeString.slice(orPosn + 1)
        modeString = firstHalf.concat(', or', secondHalf)
      }
      finalComparison[comparator].highestPercentage.mode = modeString
      finalComparison[comparator].highestPercentage.value = allStats[`${user}`][comparator]
      finalComparison[comparator].highestPercentage.rolls = allStats[`${user}`].count
      finalComparison[comparator].highestPercentage.percentage = Math.round((((finalComparison[comparator].highestPercentage.value) / (finalComparison[comparator].highestPercentage.rolls))) * 100)
    }
  }
}

class RollTrackerDialog extends FormApplication {
  constructor(userId, options = {}) {
    super(userId, options)
  }

  static get defaultOptions() {
    const defaults = super.defaultOptions
    const overrides = {
      height: 'auto',
      width: 'auto',
      id: 'roll-tracker',
      template: `modules/roll-tracker/templates/roll-tracker.hbs`,
      title: 'Roll Tracker',
    }
    return foundry.utils.mergeObject(defaults, overrides)
  }

  get exportData() {
    return RollTrackerData.getUserRolls(game.userId)?.export
  }

  async getData() {
    const rollData = RollTrackerData.prepareRollStats(this.object)

    // The lines below convert the mode array returned from prepTrackedRolls into a prettier
    // string for display purposes. We choose to do the conversion to string here so that the
    // prepTrackedRolls func can continue to generate raw data which can be more easily
    // read/compared/manipulated, as in generalComparison()

    rollData.stats.mode = rollData.stats.mode.join(', ')
    return rollData
  }

  async prepCompCard() {
    let comparison = await RollTrackerData.generalComparison()
    let content = await renderTemplate(`modules/roll-tracker/templates/roll-tracker-comparison-card.hbs`, comparison)
    ChatMessage.create({content})
  }

  activateListeners(html) {
    super.activateListeners(html);

    // With the below function, we are specifying that for the _handleButtonClick function,
    // the keyword 'this' will refer to the current value of this as used in the bind function
    // i.e. RollTrackerDialog
    html.on('click', "[data-action]", this._handleButtonClick.bind(this))
  }

  async _handleButtonClick(event) {
    const clickedElement = $(event.currentTarget)
    const action = clickedElement.data().action
    const userId = clickedElement.parents(`[data-userId]`)?.data().userid
    switch (action) {
      case 'clear': {
        const confirmed = Dialog.confirm({
          title: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.title"),
          content: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.content"),
        })
        if (confirmed) {
          await RollTrackerData.clearTrackedRolls(userId)
          this.render();
        }
        break
      }
      case 'print': {
        const rollData = RollTrackerData.prepareRollStats(this.object)
        rollData.stats.mode = rollData.stats.mode.join(', ')
        const content = await renderTemplate(`modules/roll-tracker/templates/roll-tracker-chat.hbs`, rollData)
        ChatMessage.create({content})
      }
    }
  }

  _getHeaderButtons() {
    let buttons = super._getHeaderButtons();
    buttons.splice(0, 0, {
      class: "roll-tracker-form-export",
      icon: "fas fa-download",
      onclick: () => {
        if (this.exportData) {
          saveDataToFile(this.exportData, 'string', 'roll-data.txt')
        } else {
          return ui.notifications.warn("No roll data to export")
        }
      }
    })
    if (game.user.isGM) {
      buttons.splice(1, 0, {
        class: "roll-tracker-form-comparison",
        icon: "fas fa-chart-simple",
        onclick: () => {
          this.prepCompCard()
        }
      })
    }
    return buttons
  }
}


function calcAverage(list) {
  const sum = list.reduce((firstValue, secondValue) => {
    return firstValue + secondValue
  })
  return Math.round(sum / list.length);
}

function calcMedian(list) {
  list = list.sort((a, b) => a - b)
  if (list.length % 2 === 1) {
    let medianPosition = Math.floor(list.length / 2)
    return list[medianPosition]
  } else {
    let beforeMedian = (list.length / 2)
    let afterMedian = beforeMedian + 1
    return (list[beforeMedian - 1] + list[afterMedian - 1]) / 2
  }
}