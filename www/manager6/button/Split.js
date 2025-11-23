/* Button features:
 * - observe selection changes to enable/disable the button using enableFn()
 * - pop up confirmation dialog using confirmMsg()
 *
 *   does this for the button and every menu item
 */
Ext.define('PVE.button.Split', {
    extend: 'Ext.button.Split',
    alias: 'widget.pveSplitButton',

    // the selection model to observe
    selModel: undefined,

    // if 'false' handler will not be called (button disabled)
    enableFn: function (record) {
        // do nothing
    },

    // function(record) or text
    confirmMsg: false,

    // take special care in confirm box (select no as default).
    dangerous: false,

    handlerWrapper: function (button, event) {
        var me = this;
        var rec, msg;
        if (me.selModel) {
            rec = me.selModel.getSelection()[0];
            if (!rec || me.enableFn(rec) === false) {
                return;
            }
        }

        if (me.confirmMsg) {
            msg = me.confirmMsg;
            // confirMsg can be boolean or function
            if (Ext.isFunction(me.confirmMsg)) {
                msg = me.confirmMsg(rec);
            }
            Ext.MessageBox.defaultButton = me.dangerous ? 2 : 1;
            Ext.Msg.show({
                title: gettext('Confirm'),
                icon: me.dangerous ? Ext.Msg.WARNING : Ext.Msg.QUESTION,
                msg: msg,
                buttons: Ext.Msg.YESNO,
                callback: function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }
                    me.realHandler(button, event, rec);
                },
            });
        } else {
            me.realHandler(button, event, rec);
        }
    },

    initComponent: function () {
        var me = this;

        if (me.handler) {
            me.realHandler = me.handler;
            me.handler = me.handlerWrapper;
        }

        if (me.menu && me.menu.items) {
            me.menu.items.forEach(function (item) {
                if (item.handler) {
                    item.realHandler = item.handler;
                    item.handler = me.handlerWrapper;
                }

                if (item.selModel) {
                    me.mon(item.selModel, 'selectionchange', function () {
                        var rec = item.selModel.getSelection()[0];
                        if (!rec || item.enableFn(rec) === false) {
                            item.setDisabled(true);
                        } else {
                            item.setDisabled(false);
                        }
                    });
                }
            });
        }

        me.callParent();

        if (me.selModel) {
            me.mon(me.selModel, 'selectionchange', function () {
                var rec = me.selModel.getSelection()[0];
                if (!rec || me.enableFn(rec) === false) {
                    me.setDisabled(true);
                } else {
                    me.setDisabled(false);
                }
            });
        }
    },
});
