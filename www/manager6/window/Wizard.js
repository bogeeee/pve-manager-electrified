Ext.define('PVE.window.Wizard', {
    extend: 'Ext.window.Window',

    activeTitle: '', // used for automated testing

    width: 720,
    height: 540,

    modal: true,
    border: false,

    draggable: true,
    closable: true,
    resizable: false,

    layout: 'border',

    getValues: function (dirtyOnly) {
        let me = this;

        let values = {};

        me.down('form')
            .getForm()
            .getFields()
            .each((field) => {
                if (!field.up('inputpanel') && (!dirtyOnly || field.isDirty())) {
                    Proxmox.Utils.assemble_field_data(values, field.getSubmitData());
                }
            });

        me.query('inputpanel').forEach((panel) => {
            Proxmox.Utils.assemble_field_data(values, panel.getValues(dirtyOnly));
        });

        return values;
    },

    initComponent: function () {
        var me = this;

        var tabs = me.items || [];
        delete me.items;

        /*
         * Items may have the following functions:
         * validator(): per tab custom validation
         * onSubmit(): submit handler
         * onGetValues(): overwrite getValues results
         */

        Ext.Array.each(tabs, function (tab) {
            tab.disabled = true;
        });
        tabs[0].disabled = false;

        let maxidx = 0,
            curidx = 0;

        let check_card = function (card) {
            let fields = card.query('field, fieldcontainer');
            if (card.isXType('fieldcontainer')) {
                fields.unshift(card);
            }
            let valid = true;
            for (const field of fields) {
                // Note: not all fielcontainer have isValid()
                if (Ext.isFunction(field.isValid) && !field.isValid()) {
                    valid = false;
                }
            }
            if (Ext.isFunction(card.validator)) {
                return card.validator();
            }
            return valid;
        };

        let disableTab = function (card) {
            let tp = me.down('#wizcontent');
            for (let idx = tp.items.indexOf(card); idx < tp.items.getCount(); idx++) {
                let tab = tp.items.getAt(idx);
                if (tab) {
                    tab.disable();
                }
            }
        };

        let tabchange = function (tp, newcard, oldcard) {
            if (newcard.onSubmit) {
                me.down('#next').setVisible(false);
                me.down('#submit').setVisible(true);
            } else {
                me.down('#next').setVisible(true);
                me.down('#submit').setVisible(false);
            }
            let valid = check_card(newcard);
            me.down('#next').setDisabled(!valid);
            me.down('#submit').setDisabled(!valid);
            me.down('#back').setDisabled(tp.items.indexOf(newcard) === 0);

            let idx = tp.items.indexOf(newcard);
            if (idx > maxidx) {
                maxidx = idx;
            }
            curidx = idx;

            let ntab = tp.items.getAt(idx + 1);
            if (valid && ntab && !newcard.onSubmit) {
                ntab.enable();
            }
        };

        if (me.subject && !me.title) {
            me.title = Proxmox.Utils.dialog_title(me.subject, true, false);
        }

        let sp = Ext.state.Manager.getProvider();
        let advancedOn = sp.get('proxmox-advanced-cb');

        Ext.apply(me, {
            items: [
                {
                    xtype: 'form',
                    region: 'center',
                    layout: 'fit',
                    border: false,
                    margins: '5 5 0 5',
                    fieldDefaults: {
                        labelWidth: 100,
                        anchor: '100%',
                    },
                    items: [
                        {
                            itemId: 'wizcontent',
                            xtype: 'tabpanel',
                            activeItem: 0,
                            bodyPadding: 0,
                            listeners: {
                                afterrender: function (tp) {
                                    tabchange(tp, this.getActiveTab());
                                },
                                tabchange: function (tp, newcard, oldcard) {
                                    tabchange(tp, newcard, oldcard);
                                },
                            },
                            defaults: {
                                padding: 10,
                            },
                            items: tabs,
                        },
                    ],
                },
            ],
            fbar: [
                {
                    xtype: 'proxmoxHelpButton',
                    itemId: 'help',
                },
                '->',
                {
                    xtype: 'proxmoxcheckbox',
                    boxLabelAlign: 'before',
                    boxLabel: gettext('Advanced'),
                    value: advancedOn,
                    listeners: {
                        change: function (_, value) {
                            let tp = me.down('#wizcontent');
                            tp.query('inputpanel').forEach(function (ip) {
                                ip.setAdvancedVisible(value);
                            });
                            sp.set('proxmox-advanced-cb', value);
                        },
                    },
                },
                {
                    text: gettext('Back'),
                    disabled: true,
                    itemId: 'back',
                    minWidth: 60,
                    handler: function () {
                        let tp = me.down('#wizcontent');
                        let prev = tp.items.indexOf(tp.getActiveTab()) - 1;
                        if (prev < 0) {
                            return;
                        }
                        let ntab = tp.items.getAt(prev);
                        if (ntab) {
                            tp.setActiveTab(ntab);
                        }
                    },
                },
                {
                    text: gettext('Next'),
                    disabled: true,
                    itemId: 'next',
                    minWidth: 60,
                    handler: function () {
                        let tp = me.down('#wizcontent');
                        let activeTab = tp.getActiveTab();
                        if (!check_card(activeTab)) {
                            return;
                        }
                        let next = tp.items.indexOf(activeTab) + 1;
                        let ntab = tp.items.getAt(next);
                        if (ntab) {
                            ntab.enable();
                            tp.setActiveTab(ntab);
                        }
                    },
                },
                {
                    text: gettext('Finish'),
                    minWidth: 60,
                    hidden: true,
                    itemId: 'submit',
                    handler: function () {
                        let tp = me.down('#wizcontent');
                        tp.getActiveTab().onSubmit();
                    },
                },
            ],
        });
        me.callParent();

        Ext.Array.each(me.query('inputpanel'), function (panel) {
            panel.setAdvancedVisible(advancedOn);
        });

        Ext.Array.each(me.query('field'), function (field) {
            let validcheck = function () {
                let tp = me.down('#wizcontent');

                // check validity for current to last enabled tab, as local change may affect validity of a later one
                for (let i = curidx; i <= maxidx && i < tp.items.getCount(); i++) {
                    let tab = tp.items.getAt(i);
                    let valid = check_card(tab);

                    // only set the buttons on the current panel
                    if (i === curidx) {
                        me.down('#next').setDisabled(!valid);
                        me.down('#submit').setDisabled(!valid);
                    }
                    // if a panel is invalid, then disable all following, else enable the next tab
                    let nextTab = tp.items.getAt(i + 1);
                    if (!valid) {
                        disableTab(nextTab);
                        return;
                    } else if (nextTab && !tab.onSubmit) {
                        nextTab.enable();
                    }
                }
            };
            field.on('change', validcheck);
            field.on('validitychange', validcheck);
        });
    },
});
