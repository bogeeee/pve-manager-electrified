Ext.define('PVE.dc.UserTagAccessEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveUserTagAccessEdit',

    subject: gettext('User Tag Access'),
    onlineHelp: 'gui_tags',

    url: '/api2/extjs/cluster/options',

    hintText: gettext('NOTE: The following tags are also defined as registered tags.'),

    controller: {
        xclass: 'Ext.app.ViewController',

        tagChange: function (field, value) {
            let me = this;
            let view = me.getView();
            let also_registered = [];
            value = Ext.isArray(value) ? value : value.split(';');
            value.forEach((tag) => {
                if (view.registered_tags.indexOf(tag) !== -1) {
                    also_registered.push(tag);
                }
            });
            let hint_field = me.lookup('hintField');
            hint_field.setVisible(also_registered.length > 0);
            if (also_registered.length > 0) {
                hint_field.setValue(`${view.hintText} ${also_registered.join(', ')}`);
            }
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            setValues: function (values) {
                this.up('pveUserTagAccessEdit').registered_tags = values?.['registered-tags'] ?? [];
                let data = values?.['user-tag-access'] ?? {};
                return Proxmox.panel.InputPanel.prototype.setValues.call(this, data);
            },
            onGetValues: function (values) {
                if (values === undefined || Object.keys(values).length === 0) {
                    return { delete: 'user-tag-access' };
                }
                return {
                    'user-tag-access': PVE.Parser.printPropertyString(values),
                };
            },
            items: [
                {
                    name: 'user-allow',
                    fieldLabel: gettext('Mode'),
                    xtype: 'proxmoxKVComboBox',
                    deleteEmpty: false,
                    value: '__default__',
                    comboItems: [
                        ['__default__', Proxmox.Utils.defaultText + ' (free)'],
                        ['free', 'free'],
                        ['existing', 'existing'],
                        ['list', 'list'],
                        ['none', 'none'],
                    ],
                    defaultValue: '__default__',
                },
                {
                    xtype: 'displayfield',
                    fieldLabel: gettext('Predefined Tags'),
                },
                {
                    name: 'user-allow-list',
                    xtype: 'pveListField',
                    emptyText: gettext('No Tags defined'),
                    fieldTitle: gettext('Tag'),
                    maskRe: PVE.Utils.tagCharRegex,
                    gridConfig: {
                        height: 200,
                        scrollable: true,
                    },
                    listeners: {
                        change: 'tagChange',
                    },
                },
                {
                    hidden: true,
                    xtype: 'displayfield',
                    reference: 'hintField',
                    userCls: 'pmx-hint',
                },
            ],
        },
    ],
});
