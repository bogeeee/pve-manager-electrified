Ext.define('PVE.dc.RegisteredTagsEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveRegisteredTagEdit',

    subject: gettext('Registered Tags'),
    onlineHelp: 'gui_tags',

    url: '/api2/extjs/cluster/options',

    hintText: gettext('NOTE: The following tags are also defined in the user allow list.'),

    controller: {
        xclass: 'Ext.app.ViewController',

        tagChange: function (field, value) {
            let me = this;
            let view = me.getView();
            let also_allowed = [];
            value = Ext.isArray(value) ? value : value.split(';');
            value.forEach((tag) => {
                if (view.allowed_tags.indexOf(tag) !== -1) {
                    also_allowed.push(tag);
                }
            });
            let hint_field = me.lookup('hintField');
            hint_field.setVisible(also_allowed.length > 0);
            if (also_allowed.length > 0) {
                hint_field.setValue(`${view.hintText} ${also_allowed.join(', ')}`);
            }
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            setValues: function (values) {
                let allowed_tags = values?.['user-tag-access']?.['user-allow-list'] ?? [];
                this.up('pveRegisteredTagEdit').allowed_tags = allowed_tags;
                let tags = values?.['registered-tags'];
                return Proxmox.panel.InputPanel.prototype.setValues.call(this, { tags });
            },
            onGetValues: function (values) {
                if (!values.tags) {
                    return {
                        delete: 'registered-tags',
                    };
                } else {
                    return {
                        'registered-tags': values.tags,
                    };
                }
            },
            items: [
                {
                    name: 'tags',
                    xtype: 'pveListField',
                    maskRe: PVE.Utils.tagCharRegex,
                    gridConfig: {
                        height: 200,
                        scrollable: true,
                        emptyText: gettext('No Tags defined'),
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
